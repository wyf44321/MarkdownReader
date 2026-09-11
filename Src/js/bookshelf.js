/**
 * 书架首页：搜索栏、阅读历史、书籍卡片网格。
 */
const Bookshelf = (() => {
  const PREVIEW_LIMIT = 5;
  let _books = [];
  let _query = '';
  let _historyExpanded = false;
  let _onOpenBook = null;

  function init(onOpenBook) {
    _onOpenBook = onOpenBook;
    const pageInput = document.getElementById('bookshelf-search-input');
    if (pageInput) {
      pageInput.addEventListener('input', () => {
        filter(pageInput.value);
        const top = document.getElementById('top-search-input');
        if (top && top.value !== pageInput.value) top.value = pageInput.value;
      });
    }
    const moreBtn = document.getElementById('history-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        _historyExpanded = !_historyExpanded;
        _renderHistory();
      });
    }
  }

  async function load() {
    const grid = document.getElementById('book-grid');
    const empty = document.getElementById('books-empty');
    try {
      const resp = await fetch('/api/books');
      const data = await resp.json();
      if (!resp.ok) {
        _books = [];
        if (grid) grid.innerHTML = '';
        if (empty) {
          empty.hidden = false;
          empty.textContent = data.error || '无法加载书籍列表。';
        }
        _renderHistory();
        return;
      }
      _books = Array.isArray(data) ? data : [];
      if (_books.length) ReadingHistory.retain(_books);
      _renderBooks();
      _renderHistory();
    } catch (err) {
      _books = [];
      if (empty) {
        empty.hidden = false;
        empty.textContent = '无法连接服务器。';
      }
    }
  }

  function filter(query) {
    _query = (query || '').trim().toLowerCase();
    _renderBooks();
  }

  function _bookById(id) {
    return _books.find((b) => b.id === id) || null;
  }

  function _bookForHistory(item) {
    if (!item) return null;
    const byId = _bookById(item.bookId);
    if (byId) return byId;
    const name = item.bookName;
    if (!name) return null;
    const matches = _books.filter((b) => b.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  function _placeholderHtml(extra) {
    return '<div class="book-cover-placeholder' + extra + '" aria-hidden="true">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' +
      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
      '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' +
      '</svg></div>';
  }

  function _coverHtml(book, extraClass) {
    const extra = extraClass ? ' ' + extraClass : '';
    if (book && book.coverUrl) {
      return _placeholderHtml(extra + ' book-cover-mask') +
        '<img class="book-cover-img' + extra + '" src="' + _esc(book.coverUrl) +
        '" alt="' + _esc(book.name || '') + '">';
    }
    return _placeholderHtml(extra);
  }

  function _matchesBook(book, query) {
    if (!query) return true;
    if ((book.name || '').toLowerCase().includes(query)) return true;
    if ((book.id || '').toLowerCase().includes(query)) return true;
    const meta = book.meta || {};
    for (const [k, v] of Object.entries(meta)) {
      if (String(k).toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) {
        return true;
      }
    }
    return false;
  }

  function _esc(str) {
    const el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  function _metaRows(meta) {
    const entries = Object.entries(meta || {});
    if (!entries.length) return '';
    const shown = entries.slice(0, 3);
    const hasMore = entries.length > 3;
    let html = '<div class="book-meta">';
    shown.forEach(([k, v], i) => {
      const tail = (i === shown.length - 1 && hasMore)
        ? '<span class="book-meta-more">...</span>'
        : '';
      html += '<div class="book-meta-row">' +
        '<span class="meta-key">' + _esc(k) + '</span>' +
        '<span class="meta-val">' + _esc(v) + '</span>' +
        tail +
        '</div>';
    });
    html += '<div class="book-meta-tip" role="tooltip">';
    for (const [k, v] of entries) {
      html += '<div class="book-meta-tip-row">' +
        '<span class="meta-key">' + _esc(k) + '</span>' +
        '<span class="meta-val">' + _esc(v) + '</span>' +
        '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function _renderBooks() {
    const grid = document.getElementById('book-grid');
    const empty = document.getElementById('books-empty');
    if (!grid) return;
    const visible = _books.filter((b) => _matchesBook(b, _query));
    grid.innerHTML = '';
    if (!visible.length) {
      if (empty) {
        empty.hidden = false;
        empty.textContent = _books.length ? '没有匹配的书籍。' : '还没有发现书籍。请在 booksRoot 的下一层目录放入 config_mdr.jsonc，或用 booksCfg 指定书籍配置文件。';
      }
      return;
    }
    if (empty) empty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const book of visible) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'book-card';
      card.innerHTML =
        '<div class="book-cover">' + _coverHtml(book) + '</div>' +
        '<div class="book-card-body">' +
        '<div class="book-title" title="' + _esc(book.name) + '">' + _esc(book.name) + '</div>' +
        _metaRows(book.meta) +
        '</div>';
      card.addEventListener('click', () => {
        if (_onOpenBook) _onOpenBook(book.id);
      });
      frag.appendChild(card);
    }
    grid.appendChild(frag);
  }

  function _historyItems() {
    const seen = new Set();
    const items = [];
    for (const item of ReadingHistory.list()) {
      const book = _bookForHistory(item);
      const key = (book && book.id) || item.bookName || item.bookId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    return items;
  }

  function _historyItemHtml(item) {
    const book = _bookForHistory(item);
    const name = (book && book.name) || item.bookName || item.bookId;
    const coverBook = {
      name: name,
      coverUrl: (book && book.coverUrl) || item.coverUrl || null
    };
    const openId = (book && book.id) || item.bookId;
    const docLabel = (item.docPath === '#' || item.docPath === '__home') ? '首页' : (item.docTitle || item.docPath || '');
    return '<button type="button" class="history-card" data-book-id="' + _esc(openId) + '">' +
      '<div class="history-cover">' + _coverHtml(coverBook, 'history') + '</div>' +
      '<div class="history-info">' +
      '<div class="history-title">' + _esc(name) + '</div>' +
      '<div class="history-doc">' + _esc(docLabel) + '</div>' +
      '</div></button>';
  }

  function _bindHistoryClicks(root) {
    root.querySelectorAll('.history-card[data-book-id]').forEach((el) => {
      el.addEventListener('click', () => {
        if (_onOpenBook) _onOpenBook(el.dataset.bookId);
      });
    });
  }

  function _renderHistory() {
    const section = document.getElementById('history-section');
    const preview = document.getElementById('history-preview');
    const grouped = document.getElementById('history-grouped');
    const moreBtn = document.getElementById('history-more-btn');
    if (!section || !preview || !grouped) return;

    const items = _historyItems();
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    if (moreBtn) {
      moreBtn.hidden = items.length <= PREVIEW_LIMIT;
      moreBtn.textContent = _historyExpanded ? '收起' : '更多';
    }

    if (!_historyExpanded) {
      grouped.hidden = true;
      preview.hidden = false;
      preview.innerHTML = items.slice(0, PREVIEW_LIMIT).map(_historyItemHtml).join('');
      _bindHistoryClicks(preview);
      return;
    }

    preview.hidden = true;
    grouped.hidden = false;
    const groups = ReadingHistory.groupByTime(items);
    grouped.innerHTML = groups.map((g) => {
      return '<div class="history-group">' +
        '<h3 class="history-group-title">' + _esc(g.label) + '</h3>' +
        '<div class="history-group-grid">' + g.items.map(_historyItemHtml).join('') + '</div>' +
        '</div>';
    }).join('');
    _bindHistoryClicks(grouped);
  }

  function refreshHistory() {
    _renderHistory();
  }

  return { init, load, filter, refreshHistory };
})();
