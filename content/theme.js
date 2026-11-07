// 다크 모드 감지 → <html class="ytx-dark">
// 라이브 채팅 iframe 등에서는 html[dark] 속성이 없을 수 있어 실제 배경 밝기로 판단한다.
(() => {
  'use strict';

  function bgIsDark() {
    const els = [
      document.querySelector('yt-live-chat-app'),
      document.querySelector('ytd-app'),
      document.body,
      document.documentElement,
    ];
    for (const el of els) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m) continue;
      const [r, g, b, a = 1] = m.map(Number);
      if (a === 0) continue; // 투명 → 다음 요소
      return 0.299 * r + 0.587 * g + 0.114 * b < 128;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function sync() {
    const root = document.documentElement;
    const dark = root.hasAttribute('dark') || bgIsDark();
    if (root.classList.contains('ytx-dark') !== dark) root.classList.toggle('ytx-dark', dark);
  }

  sync();
  // 테마 전환(설정 메뉴) 시 html 속성/스타일이 바뀜
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['dark', 'style'],
  });
  // 페이지가 늦게 그려지는 경우 대비
  window.addEventListener('load', sync);
  setTimeout(sync, 2000);
})();
