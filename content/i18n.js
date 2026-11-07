// UI 문구 다국어 지원 (한국어 · 日本語 · English)
// 언어는 유튜브 화면 언어(<html lang>)를 따른다. 한국어·일본어가 아니면 영어.
(() => {
  'use strict';

  const MESSAGES = {
    ko: {
      emoji: '이모티콘',
      close: '닫기',
      cancel: '취소',
      save: '저장',
      saved: '저장했습니다',
      // 이모티콘 순서
      orderButton: '⇅ 순서',
      orderButtonTitle: '이 카테고리의 이모티콘 순서 편집',
      orderHint: '드래그해서 순서를 바꾸세요 · 더블클릭: 맨 앞으로 · Alt+클릭: 맨 뒤로',
      orderLocal: '💾 순서는 이 브라우저에만(로컬) 저장되며 다른 PC·브라우저와 동기화되지 않습니다.',
      orderReset: '기본 순서',
      // 관용구
      phrases: '관용구',
      addButton: '+ 추가',
      addButtonTitle: '새 관용구 만들기',
      phrasesEmpty: '채팅 메시지의 ☆ 버튼이나 + 추가로 관용구를 등록하세요',
      chipHelp: '클릭: 입력 · 우클릭: 편집/삭제 · 드래그: 순서 변경',
      menuEdit: '편집',
      menuCopy: '복사(텍스트)',
      menuDelete: '삭제',
      copied: '복사했습니다',
      deleted: '삭제했습니다',
      inputNotFound: '채팅 입력창을 찾을 수 없습니다',
      paletteSearch: '이모티콘 검색 (예: heart, smile)',
      paletteLoading: '이모티콘을 불러오는 중…',
      paletteFailed: '이모티콘 목록을 불러오지 못했습니다. 채팅의 이모티콘 버튼을 한 번 누른 뒤 다시 열어 주세요.',
      editorTitleEdit: '관용구 편집',
      editorTitleAdd: '관용구 추가',
      nameLabel: '이름',
      namePlaceholder: '(선택) 예: 장미 탄막',
      scopeLabel: '범위',
      scopeChannel: '이 채널 전용',
      scopeGlobal: '모든 채널 공용',
      scopeHintCustom: '채널 이모티콘이 들어 있어 이 채널 전용으로만 저장할 수 있습니다.',
      scopeHintNoChannel: '채널을 확인할 수 없어 공용으로 저장됩니다. (이모티콘 선택창을 한 번 열면 인식됩니다)',
      contentLabel: '내용 (드래그: 순서 · ✕: 삭제)',
      remove: '삭제',
      contentEmpty: '비어 있음',
      textPlaceholder: '텍스트·유니코드 이모티콘 (예: 🥀🎶)',
      addText: '추가',
      undoTitle: '마지막 하나 지우기',
      phrasesLocal: '💾 관용구는 이 브라우저에만(로컬) 저장되며 다른 PC·브라우저와 동기화되지 않습니다.',
      nothingInContent: '내용이 비어 있습니다',
      starTitle: '이 메시지를 관용구로 저장',
      nothingToSave: '저장할 내용이 없습니다',
    },
    ja: {
      emoji: '絵文字',
      close: '閉じる',
      cancel: 'キャンセル',
      save: '保存',
      saved: '保存しました',
      orderButton: '⇅ 並び順',
      orderButtonTitle: 'このカテゴリの絵文字の並び順を編集',
      orderHint: 'ドラッグで並べ替え · ダブルクリック: 先頭へ · Alt+クリック: 末尾へ',
      orderLocal: '💾 並び順はこのブラウザ内(ローカル)にのみ保存され、ほかの PC やブラウザとは同期されません。',
      orderReset: '既定の並び順',
      phrases: '定型文',
      addButton: '+ 追加',
      addButtonTitle: '新しい定型文を作成',
      phrasesEmpty: 'チャットメッセージの ☆ ボタンか「+ 追加」で定型文を登録できます',
      chipHelp: 'クリック: 入力 · 右クリック: 編集/削除 · ドラッグ: 並べ替え',
      menuEdit: '編集',
      menuCopy: 'テキストとしてコピー',
      menuDelete: '削除',
      copied: 'コピーしました',
      deleted: '削除しました',
      inputNotFound: 'チャット入力欄が見つかりません',
      paletteSearch: '絵文字を検索 (例: heart, smile)',
      paletteLoading: '絵文字を読み込んでいます…',
      paletteFailed: '絵文字の一覧を読み込めませんでした。チャットの絵文字ボタンを一度押してから、もう一度開いてください。',
      editorTitleEdit: '定型文を編集',
      editorTitleAdd: '定型文を追加',
      nameLabel: '名前',
      namePlaceholder: '(任意) 例: バラの弾幕',
      scopeLabel: '範囲',
      scopeChannel: 'このチャンネルのみ',
      scopeGlobal: 'すべてのチャンネル',
      scopeHintCustom: 'チャンネルの絵文字が含まれているため、このチャンネル専用としてのみ保存できます。',
      scopeHintNoChannel: 'チャンネルを判別できないため、すべてのチャンネル向けに保存されます。(絵文字ピッカーを一度開くと認識されます)',
      contentLabel: '内容 (ドラッグ: 並べ替え · ✕: 削除)',
      remove: '削除',
      contentEmpty: '空です',
      textPlaceholder: 'テキスト・Unicode 絵文字 (例: 🥀🎶)',
      addText: '追加',
      undoTitle: '最後の1つを削除',
      phrasesLocal: '💾 定型文はこのブラウザ内(ローカル)にのみ保存され、ほかの PC やブラウザとは同期されません。',
      nothingInContent: '内容が空です',
      starTitle: 'このメッセージを定型文として保存',
      nothingToSave: '保存する内容がありません',
    },
    en: {
      emoji: 'Emoji',
      close: 'Close',
      cancel: 'Cancel',
      save: 'Save',
      saved: 'Saved',
      orderButton: '⇅ Order',
      orderButtonTitle: 'Reorder emojis in this category',
      orderHint: 'Drag to reorder · Double-click: move to front · Alt+click: move to end',
      orderLocal: '💾 The order is saved only in this browser (locally) and is not synced to other PCs or browsers.',
      orderReset: 'Default order',
      phrases: 'Phrases',
      addButton: '+ Add',
      addButtonTitle: 'Create a new phrase',
      phrasesEmpty: 'Save phrases with the ☆ button on chat messages, or with + Add',
      chipHelp: 'Click: insert · Right-click: edit/delete · Drag: reorder',
      menuEdit: 'Edit',
      menuCopy: 'Copy as text',
      menuDelete: 'Delete',
      copied: 'Copied',
      deleted: 'Deleted',
      inputNotFound: "Can't find the chat input",
      paletteSearch: 'Search emojis (e.g. heart, smile)',
      paletteLoading: 'Loading emojis…',
      paletteFailed: "Couldn't load the emoji list. Click the emoji button in chat once, then open this again.",
      editorTitleEdit: 'Edit phrase',
      editorTitleAdd: 'Add phrase',
      nameLabel: 'Name',
      namePlaceholder: '(optional) e.g. Rose danmaku',
      scopeLabel: 'Scope',
      scopeChannel: 'This channel only',
      scopeGlobal: 'All channels',
      scopeHintCustom: 'This contains channel emojis, so it can only be saved for this channel.',
      scopeHintNoChannel: "Couldn't identify the channel, so this will be saved for all channels. (Open the emoji picker once to detect it.)",
      contentLabel: 'Content (drag: reorder · ✕: remove)',
      remove: 'Remove',
      contentEmpty: 'Empty',
      textPlaceholder: 'Text or Unicode emoji (e.g. 🥀🎶)',
      addText: 'Add',
      undoTitle: 'Remove the last item',
      phrasesLocal: '💾 Phrases are saved only in this browser (locally) and are not synced to other PCs or browsers.',
      nothingInContent: 'Content is empty',
      starTitle: 'Save this message as a phrase',
      nothingToSave: 'Nothing to save',
    },
  };

  /** 유튜브 화면 언어 → ko / ja / en */
  function detectLang() {
    const candidates = [document.documentElement.lang];
    try {
      candidates.push(window.top.document.documentElement.lang); // 라이브 채팅 iframe → 시청 페이지
    } catch (_) {
      /* cross-origin */
    }
    candidates.push(navigator.language);
    for (const c of candidates) {
      const l = (c || '').toLowerCase();
      if (!l) continue;
      if (l.startsWith('ko')) return 'ko';
      if (l.startsWith('ja')) return 'ja';
      return 'en';
    }
    return 'en';
  }

  const lang = detectLang();
  const dict = MESSAGES[lang];

  /** @param {keyof typeof MESSAGES.ko} key */
  const t = (key) => dict[key] ?? MESSAGES.en[key] ?? key;

  // 같은 확장 프로그램의 content script끼리는 isolated world를 공유한다.
  globalThis.ytxI18n = { t, lang };
})();
