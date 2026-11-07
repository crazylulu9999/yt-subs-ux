// 이모티콘 선택창(yt-emoji-picker) 순서 커스텀
//
// 방식: YouTube(Polymer dom-repeat)가 관리하는 <img> 노드를 DOM에서 옮기지 않고
// CSS `order` 속성만 지정한다. dom-repeat가 노드를 재사용/재렌더링해도 깨지지 않는다.
//
// 저장 키(카테고리 키)
//   - 채널 커스텀 이모티콘: "ch:<채널ID>"   (img id = "<채널ID>/<이모티콘ID>")
//   - 일반 유니코드 카테고리: "g:<기본 순서상 첫 이모티콘>"
(() => {
  'use strict';

  const STORE_KEY = 'emojiOrder'; // { [categoryKey]: string[] (emoji keys) }
  const CAT_SEL = 'yt-emoji-picker-category-renderer';
  const SCAN_INTERVAL = 300;

  /** @type {Record<string, string[]>} */
  let orders = {};
  let ordersVersion = 0;

  // ---------- storage ----------
  function loadOrders() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORE_KEY, (data) => {
        orders = (data && data[STORE_KEY]) || {};
        ordersVersion++;
        resolve();
      });
    });
  }

  function saveOrders() {
    return new Promise((resolve) => chrome.storage.local.set({ [STORE_KEY]: orders }, resolve));
  }

  // 다른 프레임(라이브 채팅 iframe 등)에서 저장한 변경도 즉시 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    orders = changes[STORE_KEY].newValue || {};
    ordersVersion++;
    scanNow();
  });

  // ---------- helpers ----------
  const emojiKey = (img) => img.id || img.getAttribute('aria-label') || img.alt || img.src;

  function getBox(renderer) {
    return renderer.querySelector('#emoji');
  }

  /** DOM(=YouTube 기본) 순서의 이모티콘 목록 */
  function getImgs(renderer) {
    const box = getBox(renderer);
    if (!box) return [];
    return Array.from(box.children).filter((el) => el.tagName === 'IMG');
  }

  function categoryKey(imgs) {
    if (!imgs.length) return null;
    const first = emojiKey(imgs[0]);
    const slash = first.indexOf('/');
    return slash > 0 ? 'ch:' + first.slice(0, slash) : 'g:' + first;
  }

  function categoryTitle(renderer) {
    return renderer.getAttribute('aria-label') || '이모티콘';
  }

  /** 저장된 순서를 반영한 정렬 결과 (저장 목록에 없는 새 이모티콘은 기본 순서대로 뒤에) */
  function sortedImgs(imgs, order) {
    if (!order || !order.length) return imgs.slice();
    const rank = new Map(order.map((k, i) => [k, i]));
    return imgs
      .map((img, i) => {
        const r = rank.get(emojiKey(img));
        return { img, r: r === undefined ? order.length + i : r };
      })
      .sort((a, b) => a.r - b.r)
      .map((x) => x.img);
  }

  // ---------- apply ----------
  function applyOrder(renderer, force) {
    const imgs = getImgs(renderer);
    const key = categoryKey(imgs);
    if (!key) return;

    const sig = [ordersVersion, key, imgs.length, emojiKey(imgs[imgs.length - 1])].join('|');
    if (!force && renderer.__ytecSig === sig) return;
    renderer.__ytecSig = sig;

    const box = getBox(renderer);
    const order = orders[key];

    if (!order) {
      imgs.forEach((img) => img.style.removeProperty('order'));
      return;
    }

    // `order`는 flex/grid 컨테이너에서만 동작
    const display = getComputedStyle(box).display;
    if (!/flex|grid/.test(display)) box.classList.add('ytec-flex');

    sortedImgs(imgs, order).forEach((img, i) => img.style.setProperty('order', String(i)));
  }

  function ensureEditButton(renderer) {
    const title = renderer.querySelector('#title');
    // 제목 줄 안에 넣어 글자를 가리지 않게 한다 (제목이 다시 그려지면 재삽입)
    if (!title || title.querySelector('.ytec-edit-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytec-edit-btn';
    btn.textContent = '⇅ 순서';
    btn.title = '이 카테고리의 이모티콘 순서 편집';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditor(renderer);
    });
    title.classList.add('ytec-title-row');
    title.appendChild(btn);
  }

  function scanNow() {
    document.querySelectorAll(CAT_SEL).forEach((r) => {
      // 검색 결과 카테고리는 제외 (저장하면 채널 순서를 검색 결과 일부로 덮어씀)
      if (r.id === 'search-category') return;
      ensureEditButton(r);
      applyOrder(r);
    });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanNow();
    }, SCAN_INTERVAL);
  }

  // ---------- editor ----------
  let editorOpen = null;

  function openEditor(renderer) {
    if (editorOpen) editorOpen.close();

    const imgs = getImgs(renderer);
    const key = categoryKey(imgs);
    if (!key) return;

    const overlay = document.createElement('div');
    overlay.className = 'ytec-overlay';
    overlay.innerHTML = `
      <div class="ytec-modal" role="dialog" aria-modal="true">
        <div class="ytec-head">
          <span class="ytec-title"></span>
          <button type="button" class="ytec-x" aria-label="닫기">✕</button>
        </div>
        <div class="ytec-hint">드래그해서 순서를 바꾸세요 · 더블클릭: 맨 앞으로 · Alt+클릭: 맨 뒤로</div>
        <div class="ytec-grid" role="list"></div>
        <div class="ytec-local">💾 순서는 이 브라우저에만(로컬) 저장되며 다른 PC·브라우저와 동기화되지 않습니다.</div>
        <div class="ytec-foot">
          <button type="button" class="ytec-btn ytec-reset">기본 순서</button>
          <span class="ytec-spacer"></span>
          <button type="button" class="ytec-btn ytec-cancel">취소</button>
          <button type="button" class="ytec-btn ytec-primary ytec-save">저장</button>
        </div>
      </div>`;
    overlay.querySelector('.ytec-title').textContent = categoryTitle(renderer);
    const grid = overlay.querySelector('.ytec-grid');

    const makeItem = (img) => {
      const item = document.createElement('div');
      item.className = 'ytec-item';
      item.draggable = true;
      item.setAttribute('role', 'listitem');
      item.dataset.key = emojiKey(img);
      item.title = img.getAttribute('aria-label') || img.alt || '';
      const im = document.createElement('img');
      im.src = img.currentSrc || img.src;
      im.alt = img.alt || '';
      im.draggable = false;
      item.appendChild(im);
      return item;
    };

    const fill = (list) => {
      grid.replaceChildren(...list.map(makeItem));
    };
    fill(sortedImgs(imgs, orders[key]));

    // --- drag & drop (실시간 재배치) ---
    let dragging = null;
    grid.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.ytec-item');
      if (!item) return;
      dragging = item;
      item.classList.add('ytec-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.key);
    });
    grid.addEventListener('dragend', () => {
      if (dragging) dragging.classList.remove('ytec-dragging');
      dragging = null;
    });
    grid.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.ytec-item');
      if (!target || target === dragging) return;
      const rect = target.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      const ref = after ? target.nextSibling : target;
      if (ref !== dragging) grid.insertBefore(dragging, ref);
    });
    grid.addEventListener('drop', (e) => e.preventDefault());

    grid.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.ytec-item');
      if (item) grid.prepend(item);
    });
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('.ytec-item');
      if (item && e.altKey) grid.append(item);
    });

    // --- buttons ---
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      editorOpen = null;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('.ytec-x').addEventListener('click', close);
    overlay.querySelector('.ytec-cancel').addEventListener('click', close);
    overlay.querySelector('.ytec-reset').addEventListener('click', () => fill(getImgs(renderer)));
    overlay.querySelector('.ytec-save').addEventListener('click', async () => {
      const newOrder = Array.from(grid.children).map((el) => el.dataset.key);
      const defaultOrder = getImgs(renderer).map(emojiKey);
      const isDefault =
        newOrder.length === defaultOrder.length && newOrder.every((k, i) => k === defaultOrder[i]);
      if (isDefault) delete orders[key];
      else orders[key] = newOrder;
      ordersVersion++;
      close();
      await saveOrders();
      scanNow();
    });

    // 스크롤 이벤트가 뒤 페이지로 새지 않도록
    overlay.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

    document.body.appendChild(overlay);
    editorOpen = { close };
  }

  // ---------- init ----------
  loadOrders().then(() => {
    scanNow();
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
})();
