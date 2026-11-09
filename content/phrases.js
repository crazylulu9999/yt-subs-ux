// 이모티콘 관용구(탄막) — 라이브 채팅 전용
//
// 관용구 = { id, name, tokens: Token[] }
//   Token = { t: 'text', v: string }                          // 텍스트·유니코드 이모티콘
//         | { t: 'emoji', id: 'UC.../xxx', label: ':_x:', src } // 채널 커스텀 이모티콘
// 저장: chrome.storage.local.phrases = { 'ch:<채널ID>': Phrase[], 'global': Phrase[] }
(() => {
  'use strict';
  const { t } = globalThis.ytxI18n; // content/i18n.js

  if (!/^\/live_chat\/?$/.test(location.pathname)) return; // 다시보기(live_chat_replay)는 전송 불가

  const STORE_KEY = 'phrases';
  const GLOBAL = 'global';
  const YOUTUBE_EMOJI_CHANNEL = 'UCkszU2WH9gy1mb0dV-11UJg';

  /** @type {Record<string, any[]>} */
  let store = {};
  let channelId = null;

  // ======================================================================
  // storage
  // ======================================================================
  const storageGet = (k) => new Promise((r) => chrome.storage.local.get(k, (d) => r(d && d[k])));
  const storageSet = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

  async function load() {
    store = (await storageGet(STORE_KEY)) || {};
    handleMap = (await storageGet(HANDLE_KEY)) || {};
  }
  const saveStore = () => storageSet({ [STORE_KEY]: store });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch[HANDLE_KEY]) handleMap = { ...handleMap, ...(ch[HANDLE_KEY].newValue || {}) };
    if (ch[STORE_KEY]) store = ch[STORE_KEY].newValue || {};
    if (ch[STORE_KEY]) renderBar();
  });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const channelScope = () => (channelId ? 'ch:' + channelId : null);
  // 유튜브 기본 이모티콘(UCkszU2W...)은 모든 채널에서 쓸 수 있으므로 채널 전용이 아님
  const hasCustomEmoji = (tokens) =>
    tokens.some((tk) => tk.t === 'emoji' && !tk.id.startsWith(YOUTUBE_EMOJI_CHANNEL + '/'));

  function findPhrase(id) {
    for (const scope of Object.keys(store)) {
      const i = (store[scope] || []).findIndex((p) => p.id === id);
      if (i >= 0) return { scope, index: i, phrase: store[scope][i] };
    }
    return null;
  }

  // ======================================================================
  // 채널 ID 판별
  // ======================================================================
  // 확정(선택창 채널 카테고리)될 때까지는 추정값을 쓰고 계속 다시 확인한다.
  let channelConfirmed = false;

  // 채널 핸들(@xxx) → 채널 ID(UC...) 캐시. 멤버가 아니면 선택창에 채널 카테고리가 없어서,
  // 시청 페이지의 채널 이름 링크(/@핸들)로 채널을 알아낸다.
  const HANDLE_KEY = 'channelHandles';
  /** @type {Record<string, string>} */
  let handleMap = {};
  /** @type {Map<string, {busy: boolean, fails: number, retryAt: number}>} 핸들 조회 상태 */
  const lookups = new Map();
  const MAX_LOOKUP_FAILS = 3;
  const isUC = (s) => /^UC[\w-]{22}$/.test(s);

  /**
   * 시청 페이지의 채널 링크. 이 채팅이 그 시청 페이지에 들어 있는 채팅일 때만 쓴다.
   * (시청 페이지에 들어 있는 채팅의 주소에는 v=가 없다: /live_chat?continuation=...)
   */
  function ownerFromTopPage() {
    try {
      const frame = window.frameElement;
      const flexy = frame && frame.closest('ytd-watch-flexy');
      if (!flexy) return null; // 팝아웃 채팅 등
      const vid = new URLSearchParams(location.search).get('v');
      if (vid && flexy.getAttribute('video-id') !== vid) return null;
      const links = flexy.querySelectorAll(
        'ytd-video-owner-renderer a[href^="/channel/UC"], ytd-video-owner-renderer a[href^="/@"]'
      );
      for (const a of links) {
        const href = a.getAttribute('href');
        const uc = href.match(/^\/channel\/(UC[\w-]{22})/);
        if (uc) return { uc: uc[1] };
        const h = href.match(/^\/(@[^/?#]+)/);
        if (h) return { handle: decodeURIComponent(h[1]).toLowerCase() };
      }
    } catch (_) {
      /* cross-origin 또는 잘못된 인코딩 */
    }
    return null;
  }

  async function rememberHandle(handle, uc) {
    if (!handle || !isUC(uc)) return;
    handleMap = { ...handleMap, [handle]: uc };
    // 다른 탭이 그사이 저장한 항목을 지우지 않도록 저장된 값에 합쳐서 쓴다
    const saved = (await storageGet(HANDLE_KEY)) || {};
    if (saved[handle] === uc) return;
    await storageSet({ [HANDLE_KEY]: { ...saved, [handle]: uc } });
  }

  /** 채널 페이지 HTML의 canonical 링크에서 채널 ID를 찾는다 (찾으면 바로 읽기를 멈춤) */
  async function resolveHandle(handle) {
    const st = lookups.get(handle) || { busy: false, fails: 0, retryAt: 0 };
    lookups.set(handle, st);
    if (st.busy || st.fails >= MAX_LOOKUP_FAILS || Date.now() < st.retryAt) return;
    st.busy = true;
    let uc = null;
    try {
      // 쿠키를 함께 보내야 동의 화면(consent.youtube.com)으로 넘어가지 않는다
      const res = await fetch('/' + encodeURIComponent(handle));
      if (res.ok && res.body && new URL(res.url).hostname === location.hostname) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        const re =
          /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"|"externalId":"(UC[\w-]{22})"/;
        let buf = '';
        let read = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          read += value.length;
          buf += dec.decode(value, { stream: true });
          const m = buf.match(re);
          if (m) {
            uc = m[1] || m[2];
            break;
          }
          if (read > 4e6) break; // 못 찾으면 포기
          buf = buf.slice(-200); // 청크 경계에 걸친 태그도 찾을 수 있게 끝부분은 남긴다
        }
        reader.cancel().catch(() => {});
      }
    } catch (_) {
      /* 네트워크 오류 — 잠시 뒤 다시 시도 */
    }
    st.busy = false;
    if (!uc) {
      st.fails += 1;
      st.retryAt = Date.now() + 30000 * 2 ** (st.fails - 1); // 30초, 1분 뒤 재시도
      return;
    }
    await rememberHandle(handle, uc);
    const prev = channelId;
    if (detectChannelId() !== prev) renderBar();
  }

  function detectChannelId() {
    if (channelConfirmed) return channelId;

    // 1) 이모티콘 선택창의 채널(커스텀) 카테고리 — 확정 (멤버이거나 채널 이모티콘이 열려 있을 때)
    const img = document.querySelector(
      'yt-emoji-picker-category-renderer #emoji.CATEGORY_TYPE_CUSTOM > img[id*="/"]'
    );
    if (img) {
      channelConfirmed = true;
      return (channelId = img.id.split('/')[0]);
    }

    // 2) 시청 페이지의 채널 링크 (멤버가 아니어도 됨)
    const owner = ownerFromTopPage();
    if (owner) {
      if (owner.uc) return (channelId = owner.uc);
      const uc = handleMap[owner.handle];
      if (uc) return (channelId = uc);
      resolveHandle(owner.handle); // 비동기로 알아낸 뒤 다시 그린다
    }

    // 3) 채팅에 올라온 채널 이모티콘 (채널 이모티콘은 그 채널에서만 사용 가능) — 추정
    const counts = {};
    document.querySelectorAll('#message img.emoji[data-emoji-id*="/"]').forEach((el) => {
      const c = el.dataset.emojiId.split('/')[0];
      if (c !== YOUTUBE_EMOJI_CHANNEL) counts[c] = (counts[c] || 0) + 1;
    });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) return (channelId = best[0]);

    return channelId;
  }

  // ======================================================================
  // 입력창 조작
  // ======================================================================
  const inputRenderer = () => document.querySelector('yt-live-chat-message-input-renderer');
  const inputEl = () =>
    document.querySelector('yt-live-chat-text-input-field-renderer[is-chat-message-input] #input');

  function caretToEndIfOutside(input) {
    const sel = getSelection();
    if (sel.rangeCount && input.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
    const r = document.createRange();
    r.selectNodeContents(input);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function insertText(input, text) {
    // focus()를 먼저 하면 크롬이 커서를 맨 앞에 두므로, 선택 영역을 먼저 잡는다
    caretToEndIfOutside(input);
    input.focus();
    if (!document.execCommand('insertText', false, text)) {
      // execCommand가 막힌 경우 직접 삽입
      const sel = getSelection();
      const r = sel.getRangeAt(0);
      r.deleteContents();
      const node = document.createTextNode(text);
      r.insertNode(node);
      r.setStartAfter(node);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  // 유튜브가 입력창에 넣는 것과 같은 형태의 이모티콘 img (선택창 클릭이 실패했을 때의 대체 경로)
  function insertEmojiNode(input, tk) {
    // focus()를 먼저 하면 크롬이 커서를 맨 앞에 두므로, 선택 영역을 먼저 잡는다
    caretToEndIfOutside(input);
    input.focus();
    const img = document.createElement('img');
    img.className = 'emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer';
    img.src = tk.src || '';
    img.alt = (tk.label || '').replace(/^:_?|:$/g, '');
    img.dataset.emojiId = tk.id;
    img.setAttribute('shared-tooltip-text', tk.label || '');
    const sel = getSelection();
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(img);
    r.setStartAfter(img);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  }

  const pickerImg = (id) =>
    document.querySelector(
      'yt-live-chat-message-input-renderer yt-emoji-picker-renderer img[id="' + CSS.escape(id) + '"]'
    );
  const emojiToggleBtn = () =>
    document.querySelector('yt-live-chat-message-input-renderer #emoji-picker-button button');
  const isPickerOpen = () => {
    const r = inputRenderer();
    return !!(r && r.hasAttribute('emoji-open'));
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 1500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    return null;
  }

  function synthClick(el) {
    const rect = el.getBoundingClientRect();
    const opt = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, opt)));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.dispatchEvent(new MouseEvent('click', opt));
  }

  // 유니코드 이모티콘 판별 (☀, 🥀, 👨‍👩‍👧, 🇰🇷 …)
  const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  const normEmoji = (s) => s.replace(/️/g, '');

  /** 선택창의 유니코드 이모티콘: 문자 → img (FE0F 유무와 무관하게 매칭) */
  function unicodePickerMap() {
    const map = new Map();
    document
      .querySelectorAll('yt-live-chat-message-input-renderer yt-emoji-picker-category-renderer #emoji > img')
      .forEach((im) => {
        if (im.id && !im.id.includes('/')) map.set(normEmoji(im.id), im);
      });
    return map;
  }

  /**
   * 텍스트 토큰 속 유니코드 이모티콘을 따로 떼어낸다.
   * 유튜브 입력창은 이모티콘을 텍스트가 아닌 <img>로 다루므로, 글자로 넣으면
   * 글자와 이미지가 섞여 깨진다. (예: "おはようSUN☀")
   */
  function expandTokens(tokens) {
    const out = [];
    tokens.forEach((tk) => {
      if (tk.t !== 'text') return out.push(tk);
      let buf = '';
      graphemes(tk.v).forEach((g) => {
        if (EMOJI_RE.test(g)) {
          if (buf) out.push({ t: 'text', v: buf });
          buf = '';
          out.push({ t: 'uemoji', ch: g });
        } else buf += g;
      });
      if (buf) out.push({ t: 'text', v: buf });
    });
    return out;
  }

  /** 선택창 이모티콘을 클릭해 넣고, 입력창이 실제로 바뀌었는지 확인 */
  async function clickIntoInput(input, img) {
    const before = input.innerHTML;
    caretToEndIfOutside(input);
    synthClick(img);
    await sleep(0);
    return input.innerHTML !== before;
  }

  let inserting = false;
  async function insertPhrase(phrase) {
    if (inserting) return;
    const input = inputEl();
    if (!input) return toast(t('inputNotFound'));
    inserting = true;
    let openedPicker = false;
    let fallbackUsed = false;
    const tokens = expandTokens(phrase.tokens);
    // 선택창이 DOM에 없으면 한 번 열어 둔다 (이모티콘 클릭 삽입에 필요)
    const ensurePicker = async (probe) => {
      if (probe() || isPickerOpen() || !emojiToggleBtn()) return probe();
      emojiToggleBtn().click();
      openedPicker = true;
      return waitFor(probe);
    };
    try {
      caretToEndIfOutside(input);
      input.focus();

      let uMap = null;
      for (const tk of tokens) {
        if (tk.t === 'text') {
          insertText(input, tk.v);
          continue;
        }
        if (tk.t === 'uemoji') {
          // 유니코드 이모티콘: 선택창에 있으면 유튜브 방식(클릭)으로, 없으면 글자로
          if (!uMap || !uMap.size) {
            await ensurePicker(() => unicodePickerMap().size);
            uMap = unicodePickerMap();
          }
          const img = uMap.get(normEmoji(tk.ch));
          if (!img || !(await clickIntoInput(input, img))) insertText(input, tk.ch);
          continue;
        }
        // 채널 이모티콘: 유튜브 선택창 클릭으로 삽입(유튜브 자체 로직 사용)
        const img = await ensurePicker(() => pickerImg(tk.id));
        if (!img || !(await clickIntoInput(input, img))) {
          fallbackUsed = true;
          insertEmojiNode(input, tk);
        }
      }
    } finally {
      if (openedPicker && isPickerOpen() && emojiToggleBtn()) emojiToggleBtn().click();
      input.focus();
      inserting = false;
    }
    if (fallbackUsed) console.debug('[yt-subs-ux] Inserted emoji images directly because they were not found in the picker.');
  }

  // ======================================================================
  // 채팅 메시지 → 토큰
  // ======================================================================
  function tokensFromNode(root) {
    const tokens = [];
    const pushText = (s) => {
      if (!s) return;
      const last = tokens[tokens.length - 1];
      if (last && last.t === 'text') last.v += s;
      else tokens.push({ t: 'text', v: s });
    };
    const walk = (node) => {
      node.childNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) pushText(n.textContent);
        else if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.tagName === 'IMG') {
            const id = n.dataset.emojiId || '';
            if (id.includes('/')) {
              tokens.push({
                t: 'emoji',
                id,
                label: n.getAttribute('shared-tooltip-text') || ':' + n.alt + ':',
                src: n.src,
              });
            } else pushText(id || n.alt || '');
          } else walk(n);
        }
      });
    };
    walk(root);
    return tokens;
  }

  const tokensToPlain = (tokens) => tokens.map((tk) => (tk.t === 'text' ? tk.v : tk.label)).join('');

  // ======================================================================
  // 렌더링 helpers
  // ======================================================================
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderTokens(container, tokens) {
    tokens.forEach((tk) => {
      if (tk.t === 'emoji') {
        const im = el('img', 'ytph-emo');
        im.src = tk.src || pickerImg(tk.id)?.src || '';
        im.alt = tk.label;
        im.title = tk.label;
        container.appendChild(im);
      } else container.appendChild(el('span', 'ytph-txt', tk.v));
    });
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.querySelector('.ytph-toast');
    if (!t) {
      t = el('div', 'ytph-toast');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('ytph-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('ytph-show'), 1800);
  }

  // ======================================================================
  // 이모티콘 선택창 안의 "관용구" 카테고리 (탭 버튼 + 섹션) — 두 번째 위치
  // ======================================================================
  let pickerSec = null;
  let pickerTab = null;
  const pickerRoot = () =>
    document.querySelector('yt-live-chat-message-input-renderer yt-emoji-picker-renderer');

  /** 편집창이 열려 있는 동안 채널이 판별되면 범위 버튼을 갱신하는 콜백 */
  let onChannelChange = null;

  function renderBar() {
    renderPickerSection();
    if (onChannelChange) onChannelChange();
  }

  /** 채널 관용구 → 구분선 → 공용 관용구 칩 목록 */
  function buildChipList(emptyText) {
    const list = el('div', 'ytph-list');
    const cs = channelScope();
    const chan = cs ? store[cs] || [] : [];
    const glob = store[GLOBAL] || [];
    chan.forEach((p) => list.appendChild(makeChip(p, cs)));
    if (chan.length && glob.length) list.appendChild(el('span', 'ytph-sep'));
    glob.forEach((p) => list.appendChild(makeChip(p, GLOBAL)));
    if (!chan.length && !glob.length) list.appendChild(el('span', 'ytph-empty', emptyText));
    return list;
  }

  // innerHTML은 유튜브의 Trusted Types 정책에 막힐 수 있어 DOM API로 아이콘을 만든다
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function makeTabIcon(size) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'fill:currentColor;display:block;pointer-events:none';
    const path = document.createElementNS(SVG_NS, 'path');
    // 채워진 말풍선 + 따옴표 구멍 (유튜브 카테고리 아이콘처럼 꽉 찬 스타일)
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute(
      'd',
      'M4 2h16a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-8.6l-5.2 3.9A1 1 0 0 1 4.6 21v-3H4a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm2.5 5v4.2h2.1L7.4 14h1.8l1.8-3.6V7H6.5Zm6.5 0v4.2h2.1L13.9 14h1.8l1.8-3.6V7H13Z'
    );
    svg.appendChild(path);
    return svg;
  }

  /** 기존 카테고리 버튼의 크기·색을 그대로 따라간다 */
  function syncTabSize(btns) {
    const ref = btns.querySelector('yt-emoji-picker-category-button-renderer');
    if (!ref || !pickerTab) return;
    // getBoundingClientRect는 선택창 열림 애니메이션(scale)의 영향을 받으므로 offset* 사용
    const w = ref.offsetWidth;
    const h = ref.offsetHeight;
    if (!w) return;
    const icon = ref.querySelector('yt-icon');
    const iw = (icon && icon.offsetWidth) || 24;
    const sig = w + 'x' + h + '/' + iw;
    if (pickerTab.dataset.sig !== sig) {
      pickerTab.dataset.sig = sig;
      pickerTab.style.width = w + 'px';
      pickerTab.style.height = h + 'px';
      pickerTab.style.margin = getComputedStyle(ref).margin;
      pickerTab.replaceChildren(makeTabIcon(iw));
    }
    pickerTab.style.color = getComputedStyle(icon || ref).color;
  }

  /** after 바로 뒤에 node를 둔다 (이미 그 자리면 건드리지 않음 → 무한 변경 방지) */
  function placeAfter(parent, node, after) {
    const ref = after ? after.nextSibling : parent.firstChild;
    if (node.parentNode === parent && (after ? node.previousSibling === after : node === parent.firstChild)) return;
    parent.insertBefore(node, ref);
  }

  function ensurePickerUi() {
    const root = pickerRoot();
    if (!root) return;

    const cats = root.querySelector('#categories');
    if (cats) {
      if (!pickerSec) {
        pickerSec = el('div', 'ytph-cat');
        bindBarDnD(pickerSec);
      }
      const firstCat = cats.querySelector(':scope > yt-emoji-picker-category-renderer');
      const wasConnected = pickerSec.isConnected;
      placeAfter(cats, pickerSec, firstCat);
      if (!wasConnected) renderPickerSection();
    }

    const btns = root.querySelector('#category-buttons');
    if (btns) {
      if (!pickerTab) {
        pickerTab = el('button', 'ytph-cat-tab');
        pickerTab.type = 'button';
        pickerTab.title = t('phrases');
        pickerTab.setAttribute('aria-label', t('phrases'));
        pickerTab.appendChild(makeTabIcon(24));
        pickerTab.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          scrollToPickerSection();
        });
      }
      placeAfter(btns, pickerTab, btns.querySelector(':scope > yt-emoji-picker-category-button-renderer'));
      syncTabSize(btns);
      // 선택창이 닫힌 상태(크기 0)에서 만들어졌으면, 열려서 크기가 생길 때 다시 맞춘다
      if (!btns.__ytphRO) {
        btns.__ytphRO = new ResizeObserver(() => {
          syncTabSize(btns);
          const t = pickerSec && pickerSec.querySelector('.ytph-cat-title');
          if (t) copyTitleLook(t);
        });
        btns.__ytphRO.observe(btns);
      }
    }
  }

  function scrollToPickerSection() {
    if (!pickerSec || !pickerSec.isConnected) return;
    // 섹션을 감싼 스크롤 영역을 찾아 그 안에서만 스크롤 (iframe 전체가 움직이지 않게)
    const root = pickerRoot();
    for (let p = pickerSec.parentElement; p && p !== root; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
        p.scrollTop += pickerSec.getBoundingClientRect().top - p.getBoundingClientRect().top;
        return;
      }
    }
    pickerSec.scrollIntoView({ block: 'nearest' });
  }

  function renderPickerSection() {
    if (!pickerSec || !pickerSec.isConnected) return;
    detectChannelId();
    pickerSec.replaceChildren();
    const title = el('div', 'ytph-cat-title');
    title.appendChild(el('span', 'ytph-cat-name', t('phrases')));
    const add = el('button', 'ytph-cat-add', t('addButton'));
    add.type = 'button';
    add.title = t('addButtonTitle');
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(null, { tokens: [] });
    });
    title.appendChild(add);
    pickerSec.appendChild(title);
    pickerSec.appendChild(buildChipList(t('phrasesEmpty')));
    copyTitleLook(title);
  }

  /** 유튜브 카테고리 제목(#title)의 모양을 그대로 따라간다 (테마·폰트가 바뀌어도 일치) */
  const TITLE_PROPS = [
    'backgroundColor',
    'color',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
  ];
  function copyTitleLook(title) {
    const ref = pickerRoot()?.querySelector('#categories yt-emoji-picker-category-renderer #title');
    if (!ref) return; // 숨겨진 상태여도 computed style은 읽을 수 있다
    const cs = getComputedStyle(ref);
    TITLE_PROPS.forEach((p) => {
      // 투명 배경이면 우리 기본 배경 유지 (sticky 제목 뒤로 이모티콘이 비치지 않게)
      if (p === 'backgroundColor' && /rgba\(.*,\s*0\)|transparent/.test(cs[p])) return;
      title.style[p] = cs[p];
    });
  }

  function makeChip(p, scope) {
    const chip = el('button', 'ytph-chip');
    chip.type = 'button';
    chip.draggable = true;
    chip.dataset.id = p.id;
    chip.dataset.scope = scope;
    chip.title =
      (p.name ? p.name + '\n' : '') +
      tokensToPlain(p.tokens) +
      '\n\n' + t('chipHelp');
    if (scope === GLOBAL) chip.classList.add('ytph-global');
    if (p.name) chip.appendChild(el('span', 'ytph-name', p.name));
    const prev = el('span', 'ytph-prev');
    renderTokens(prev, p.tokens);
    chip.appendChild(prev);

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      insertPhrase(p);
    });
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openChipMenu(chip, p);
    });
    return chip;
  }

  function bindBarDnD(root) {
    let dragging = null;
    root.addEventListener('dragstart', (e) => {
      const chip = e.target.closest && e.target.closest('.ytph-chip');
      if (!chip) return;
      dragging = chip;
      chip.classList.add('ytph-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chip.dataset.id);
    });
    root.addEventListener('dragover', (e) => {
      if (!dragging) return;
      const target = e.target.closest && e.target.closest('.ytph-chip');
      if (!target || target === dragging || target.dataset.scope !== dragging.dataset.scope) return;
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      target.parentNode.insertBefore(dragging, after ? target.nextSibling : target);
    });
    root.addEventListener('drop', (e) => e.preventDefault());
    root.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('ytph-dragging');
      const scope = dragging.dataset.scope;
      const ids = Array.from(root.querySelectorAll('.ytph-chip'))
        .filter((c) => c.dataset.scope === scope)
        .map((c) => c.dataset.id);
      const byId = new Map((store[scope] || []).map((p) => [p.id, p]));
      store[scope] = ids.map((id) => byId.get(id)).filter(Boolean);
      dragging = null;
      saveStore();
    });
  }

  // ---------- 칩 메뉴 ----------
  function closeMenus() {
    document.querySelectorAll('.ytph-menu').forEach((m) => m.remove());
  }
  function openChipMenu(chip, p) {
    closeMenus();
    const menu = el('div', 'ytph-menu');
    const add = (label, fn, cls) => {
      const b = el('button', cls || '', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        closeMenus();
        fn();
      });
      menu.appendChild(b);
    };
    add(t('menuEdit'), () => openEditor(p.id));
    add(t('menuCopy'), () => navigator.clipboard?.writeText(tokensToPlain(p.tokens)).then(() => toast(t('copied'))));
    add(
      t('menuDelete'),
      () => {
        const f = findPhrase(p.id);
        if (!f) return;
        store[f.scope].splice(f.index, 1);
        if (!store[f.scope].length) delete store[f.scope];
        saveStore();
        renderBar();
        toast(t('deleted'));
      },
      'ytph-danger'
    );
    document.body.appendChild(menu);
    const r = chip.getBoundingClientRect();
    const mw = menu.offsetWidth;
    menu.style.left = Math.max(4, Math.min(r.left, innerWidth - mw - 4)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    if (r.bottom + 4 + menu.offsetHeight > innerHeight) menu.style.top = r.top - menu.offsetHeight - 4 + 'px';
    setTimeout(() => document.addEventListener('mousedown', onDocDownCloseMenu, true), 0);
  }
  function onDocDownCloseMenu(e) {
    if (e.target.closest && e.target.closest('.ytph-menu')) return;
    document.removeEventListener('mousedown', onDocDownCloseMenu, true);
    closeMenus();
  }

  const graphemes = (s) =>
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
      : [...s];

  /** 토큰 목록 끝에 추가 (연속 텍스트는 합친다) */
  function appendTokens(list, add) {
    JSON.parse(JSON.stringify(add)).forEach((tk) => {
      const last = list[list.length - 1];
      if (tk.t === 'text' && last && last.t === 'text') last.v += tk.v;
      else list.push(tk);
    });
  }

  // ======================================================================
  // 팝업용 이모티콘 팔레트: 유튜브 선택창 DOM에서 이모티콘 목록을 읽어온다
  // ======================================================================
  function collectPalette() {
    const root = pickerRoot();
    if (!root) return [];
    const cats = [];
    root.querySelectorAll('#categories yt-emoji-picker-category-renderer').forEach((r) => {
      const imgs = Array.from(r.querySelectorAll('#emoji > img'));
      if (!imgs.length) return;
      // 이모티콘 순서 커스텀(CSS order) 반영
      const sorted = imgs
        .map((im, i) => ({ im, o: im.style.order !== '' ? +im.style.order : 1e6 + i }))
        .sort((x, y) => x.o - y.o)
        .map((x) => x.im);
      cats.push({
        title: r.getAttribute('aria-label') || '',
        items: sorted.map((im) => ({
          id: im.id,
          label: im.getAttribute('aria-label') || '',
          alt: im.alt || '',
          src: im.getAttribute('src') || im.src,
        })),
      });
    });
    return cats;
  }

  /** 선택창이 한 번도 열리지 않아 DOM에 없으면 잠깐 열었다 닫아서 읽는다 */
  async function loadPalette() {
    let cats = collectPalette();
    if (cats.length || !emojiToggleBtn()) return cats;
    const wasOpen = isPickerOpen();
    if (!wasOpen) emojiToggleBtn().click();
    await waitFor(() => collectPalette().length, 2500);
    cats = collectPalette();
    if (!wasOpen && isPickerOpen()) emojiToggleBtn().click();
    return cats;
  }

  /**
   * 팝업 안 이모티콘 팔레트: [카테고리 탭] [검색] [그리드(관용구 + 각 카테고리)]
   * @param {(tokens:any[]) => void} onAdd
   * @param {string|null} excludeId  편집 중인 관용구는 팔레트에서 제외
   */
  function buildPalette(onAdd, excludeId) {
    const wrap = el('div', 'ytph-pal');
    const tabs = el('div', 'ytph-pal-tabs');
    const search = el('input', 'ytph-input ytph-pal-search');
    search.placeholder = t('paletteSearch');
    const grid = el('div', 'ytph-pal-grid');
    grid.appendChild(el('div', 'ytph-empty', t('paletteLoading')));
    wrap.append(tabs, search, grid);

    /** @type {{head: HTMLElement, box: HTMLElement, cells: {btn: HTMLElement, key: string}[]}[]} */
    const sections = [];

    const addTab = (label, icon, head) => {
      const t = el('button', 'ytph-pal-tab');
      t.type = 'button';
      t.title = label;
      t.setAttribute('aria-label', label);
      t.appendChild(icon);
      t.addEventListener('click', () => {
        if (search.value) {
          search.value = '';
          filter();
        }
        grid.scrollTop = head.offsetTop;
      });
      tabs.appendChild(t);
    };

    const addSection = (title, cells, boxCls) => {
      const head = el('div', 'ytph-pal-head', title);
      const box = el('div', boxCls);
      cells.forEach((c) => box.appendChild(c.btn));
      grid.append(head, box);
      sections.push({ head, box, cells });
      return head;
    };

    // 저장된 관용구 (클릭하면 통째로 이어 붙임)
    const cs = channelScope();
    const phrases = [...(cs ? store[cs] || [] : []), ...(store[GLOBAL] || [])].filter((p) => p.id !== excludeId);

    loadPalette().then((cats) => {
      grid.replaceChildren();
      if (phrases.length) {
        const cells = phrases.map((p) => {
          const b = el('button', 'ytph-chip');
          b.type = 'button';
          b.title = (p.name ? p.name + '\n' : '') + tokensToPlain(p.tokens);
          if (p.name) b.appendChild(el('span', 'ytph-name', p.name));
          const pv = el('span', 'ytph-prev');
          renderTokens(pv, p.tokens);
          b.appendChild(pv);
          b.addEventListener('click', () => onAdd(p.tokens));
          return { btn: b, key: (p.name + ' ' + tokensToPlain(p.tokens)).toLowerCase() };
        });
        addTab(t('phrases'), makeTabIcon(20), addSection(t('phrases'), cells, 'ytph-pal-phrases'));
      }
      cats.forEach((c) => {
        const cells = c.items.map((it) => {
          const b = el('button', 'ytph-pal-cell');
          b.type = 'button';
          b.title = it.label || it.alt;
          const im = el('img');
          im.loading = 'lazy';
          im.src = it.src;
          im.alt = it.alt;
          b.appendChild(im);
          b.addEventListener('click', () => onAdd([paletteToken(it)]));
          return { btn: b, key: (it.label + ' ' + it.alt).toLowerCase() };
        });
        const icon = el('img');
        icon.src = c.items[0].src;
        icon.alt = '';
        addTab(c.title, icon, addSection(c.title, cells, 'ytph-pal-cells'));
      });
      if (!cats.length) {
        grid.appendChild(
          el('div', 'ytph-empty', t('paletteFailed'))
        );
      }
    });

    function filter() {
      const q = search.value.trim().toLowerCase();
      sections.forEach((sec) => {
        let any = false;
        sec.cells.forEach((c) => {
          const ok = !q || c.key.includes(q);
          c.btn.style.display = ok ? '' : 'none';
          any = any || ok;
        });
        sec.head.style.display = any ? '' : 'none';
        sec.box.style.display = any ? '' : 'none';
      });
    }
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    return wrap;
  }

  const paletteToken = (it) =>
    it.id.includes('/')
      ? { t: 'emoji', id: it.id, label: it.label || ':' + it.alt + ':', src: it.src }
      : { t: 'text', v: it.alt || it.id };

  // ======================================================================
  // 편집 / 저장 대화상자
  // ======================================================================
  /**
   * @param {string|null} phraseId  기존 관용구 편집 시
   * @param {any} [draft]           새 관용구 초안 {tokens, name?, scope?, editingId?}
   */
  function openEditor(phraseId, draft) {
    document.querySelector('.ytph-overlay')?.remove();
    detectChannelId();
    const cs = channelScope();

    let editingId = phraseId || (draft && draft.editingId) || null;
    const found = editingId ? findPhrase(editingId) : null;
    if (editingId && !found && !draft) return;

    const state = {
      name: draft?.name ?? found?.phrase.name ?? '',
      scope: draft?.scope ?? found?.scope ?? cs ?? GLOBAL,
      tokens: JSON.parse(JSON.stringify(draft?.tokens ?? found?.phrase.tokens ?? [])),
    };

    const overlay = el('div', 'ytph-overlay');
    const modal = el('div', 'ytph-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    overlay.appendChild(modal);

    modal.appendChild(el('div', 'ytph-mtitle', editingId ? t('editorTitleEdit') : t('editorTitleAdd')));

    // 이름
    const nameRow = el('label', 'ytph-row');
    nameRow.appendChild(el('span', 'ytph-lbl', t('nameLabel')));
    const nameIn = el('input', 'ytph-input');
    nameIn.placeholder = t('namePlaceholder');
    nameIn.value = state.name;
    nameIn.maxLength = 40;
    nameRow.appendChild(nameIn);
    modal.appendChild(nameRow);

    // 범위
    const scopeRow = el('div', 'ytph-row');
    scopeRow.appendChild(el('span', 'ytph-lbl', t('scopeLabel')));
    const scopeBox = el('div', 'ytph-seg');
    const mkScope = (value, label) => {
      const b = el('button', 'ytph-segbtn', label);
      b.type = 'button';
      b.dataset.value = value;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        scopeTouched = true;
        state.scope = value;
        syncScope();
      });
      scopeBox.appendChild(b);
      return b;
    };
    let scopeTouched = false;
    let chanBtn = cs || (state.scope !== GLOBAL) ? mkScope(cs || state.scope, t('scopeChannel')) : null;
    const globBtn = mkScope(GLOBAL, t('scopeGlobal'));
    // 채널 핸들 조회가 끝나기 전에 열었으면, 판별되는 대로 '이 채널 전용'을 추가한다
    onChannelChange = () => {
      if (!overlay.isConnected) return void (onChannelChange = null);
      const ncs = channelScope();
      if (!ncs || editingId) return; // 기존 관용구 편집 중에는 범위를 바꾸지 않는다
      if (chanBtn) {
        // 추정값(채팅 이모티콘)이 더 확실한 값으로 바뀐 경우
        if (chanBtn.dataset.value === ncs) return;
        if (state.scope === chanBtn.dataset.value) state.scope = ncs;
        chanBtn.dataset.value = ncs;
      } else {
        chanBtn = mkScope(ncs, t('scopeChannel'));
        scopeBox.insertBefore(chanBtn, globBtn);
        if (!scopeTouched) state.scope = ncs;
      }
      syncScope();
    };
    scopeRow.appendChild(scopeBox);
    const scopeHint = el('div', 'ytph-hint');
    modal.appendChild(scopeRow);
    modal.appendChild(scopeHint);

    function syncScope() {
      const custom = hasCustomEmoji(state.tokens);
      if (custom && state.scope === GLOBAL && chanBtn) state.scope = chanBtn.dataset.value;
      globBtn.disabled = custom;
      [chanBtn, globBtn].filter(Boolean).forEach((b) =>
        b.classList.toggle('ytph-on', b.dataset.value === state.scope)
      );
      scopeHint.textContent = custom
        ? t('scopeHintCustom')
        : !chanBtn && state.scope === GLOBAL
        ? t('scopeHintNoChannel')
        : '';
    }

    // 토큰
    modal.appendChild(el('div', 'ytph-lbl ytph-lbl-block', t('contentLabel')));
    const tokBox = el('div', 'ytph-tokens');
    modal.appendChild(tokBox);

    function renderTokBox() {
      tokBox.replaceChildren();
      state.tokens.forEach((tk, i) => {
        const item = el('span', 'ytph-tok');
        item.draggable = true;
        item.dataset.i = i;
        renderTokens(item, [tk]);
        const x = el('button', 'ytph-tokx', '✕');
        x.type = 'button';
        x.title = t('remove');
        x.addEventListener('click', () => {
          state.tokens.splice(i, 1);
          renderTokBox();
          syncScope();
        });
        item.appendChild(x);
        tokBox.appendChild(item);
      });
      if (!state.tokens.length) tokBox.appendChild(el('span', 'ytph-empty', t('contentEmpty')));
    }
    let dragI = null;
    tokBox.addEventListener('dragstart', (e) => {
      const t = e.target.closest('.ytph-tok');
      if (!t) return;
      dragI = +t.dataset.i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragI));
    });
    tokBox.addEventListener('dragover', (e) => {
      if (dragI == null) return;
      e.preventDefault();
    });
    tokBox.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = e.target.closest('.ytph-tok');
      if (dragI == null || !t) return;
      let to = +t.dataset.i;
      const rect = t.getBoundingClientRect();
      if (e.clientX > rect.left + rect.width / 2) to++;
      const [moved] = state.tokens.splice(dragI, 1);
      if (to > dragI) to--;
      state.tokens.splice(to, 0, moved);
      dragI = null;
      renderTokBox();
    });
    tokBox.addEventListener('dragend', () => (dragI = null));

    // 텍스트 추가 / 이모티콘 추가
    const addRow = el('div', 'ytph-row');
    const txtIn = el('input', 'ytph-input');
    txtIn.placeholder = t('textPlaceholder');
    const addTxt = el('button', 'ytph-btn', t('addText'));
    addTxt.type = 'button';
    const doAddText = () => {
      if (!txtIn.value) return;
      const last = state.tokens[state.tokens.length - 1];
      if (last && last.t === 'text') last.v += txtIn.value;
      else state.tokens.push({ t: 'text', v: txtIn.value });
      txtIn.value = '';
      renderTokBox();
    };
    addTxt.addEventListener('click', doAddText);
    txtIn.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter 무시
      if (e.key === 'Enter') {
        e.preventDefault();
        doAddText();
      }
    });
    const undo = el('button', 'ytph-btn', '⌫');
    undo.type = 'button';
    undo.title = t('undoTitle');
    undo.addEventListener('click', () => {
      const last = state.tokens[state.tokens.length - 1];
      // 합성 이모티콘(👨‍👩‍👧, 🇰🇷, 피부색)을 한 글자로 지우도록 grapheme 단위로 자른다
      const g = last && last.t === 'text' ? graphemes(last.v) : [];
      if (g.length > 1) last.v = g.slice(0, -1).join('');
      else state.tokens.pop();
      renderTokBox();
      syncScope();
    });
    addRow.append(txtIn, addTxt, undo);
    modal.appendChild(addRow);

    // 이모티콘 팔레트 (클릭하면 내용 끝에 추가)
    const addFromPalette = (tokens) => {
      appendTokens(state.tokens, tokens);
      renderTokBox();
      syncScope();
      tokBox.scrollTop = tokBox.scrollHeight;
    };
    modal.appendChild(buildPalette(addFromPalette, editingId));

    modal.appendChild(
      el('div', 'ytph-local', t('phrasesLocal'))
    );

    // 버튼
    const foot = el('div', 'ytph-foot');
    const cancel = el('button', 'ytph-btn', t('cancel'));
    cancel.type = 'button';
    const save = el('button', 'ytph-btn ytph-primary', t('save'));
    save.type = 'button';
    foot.append(el('span', 'ytph-spacer'), cancel, save);
    modal.appendChild(foot);

    const onKey = (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation();
        close();
      }
    };
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    cancel.addEventListener('click', close);
    save.addEventListener('click', () => {
      if (txtIn.value) doAddText();
      if (!state.tokens.length) return toast(t('nothingInContent'));
      const phrase = {
        id: editingId || uid(),
        name: nameIn.value.trim(),
        tokens: state.tokens,
      };
      const prev = editingId ? findPhrase(editingId) : null;
      if (prev && prev.scope === state.scope) {
        store[prev.scope][prev.index] = phrase;
      } else {
        if (prev) {
          store[prev.scope].splice(prev.index, 1);
          if (!store[prev.scope].length) delete store[prev.scope];
        }
        (store[state.scope] = store[state.scope] || []).push(phrase);
      }
      saveStore();
      close();
      renderBar();
      toast(t('saved'));
    });

    // 입력창 키 이벤트가 유튜브로 새지 않도록
    modal.addEventListener('keydown', (e) => e.stopPropagation());

    renderTokBox();
    syncScope();
    document.body.appendChild(overlay);
    nameIn.focus();
  }

  // ======================================================================
  // 채팅 메시지의 ☆ 버튼
  // ======================================================================
  document.addEventListener(
    'mouseover',
    (e) => {
      const msg = e.target.closest && e.target.closest('yt-live-chat-text-message-renderer');
      if (!msg || msg.querySelector(':scope > .ytph-star')) return;
      const star = el('button', 'ytph-star', '☆');
      star.type = 'button';
      star.title = t('starTitle');
      star.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const m = msg.querySelector('#message');
        const tokens = m ? tokensFromNode(m) : [];
        if (tokens.length && tokens[0].t === 'text') tokens[0].v = tokens[0].v.replace(/^\s+/, '');
        const last = tokens[tokens.length - 1];
        if (last && last.t === 'text') last.v = last.v.replace(/\s+$/, '');
        const clean = tokens.filter((tk) => tk.t !== 'text' || tk.v);
        if (!clean.length) return toast(t('nothingToSave'));
        openEditor(null, { tokens: clean });
      });
      msg.classList.add('ytph-msg');
      msg.appendChild(star);
    },
    true
  );

  // ======================================================================
  // init
  // ======================================================================
  load().then(() => {
    detectChannelId(); // 편집창을 열기 전에 채널 핸들 조회를 시작해 둔다
    ensurePickerUi();
    let t = null;
    new MutationObserver(() => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        const prev = channelId;
        ensurePickerUi();
        if (!channelConfirmed && detectChannelId() !== prev) renderBar();
      }, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
})();
