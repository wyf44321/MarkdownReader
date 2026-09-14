/**
 * 书架首页：搜索栏、阅读历史、书籍卡片网格。
 */
const Bookshelf = (() => {
  let _books = [];
  let _query = '';
  let _historyExpanded = false;
  let _historyPage = 1;
  let _historyAnchorKey = null;
  let _onOpenBook = null;
  let _resizeTimer = null;

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
        _historyPage = 1;
        _historyAnchorKey = null;
        _renderHistory();
      });
    }
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    if (prevBtn) prevBtn.addEventListener('click', () => _stepPage(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => _stepPage(1));

    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        _renderHistory();
        _applyTipVisibility(document.getElementById('book-grid'));
      }, 120);
    });
  }

  /** 一行能放下的卡片数 = 栅格实际列数，随窗口缩放变化 */
  function _columnCount() {
    const candidates = [
      document.getElementById('history-preview'),
      document.getElementById('history-paged'),
      document.getElementById('book-grid')
    ];
    for (const el of candidates) {
      if (!el || el.hidden || !el.isConnected) continue;
      const cols = getComputedStyle(el).gridTemplateColumns;
      if (!cols || cols === 'none' || cols.includes('repeat(')) continue;
      const n = cols.split(' ').filter(Boolean).length;
      if (n > 0) return n;
    }
    const w = window.innerWidth;
    if (w <= 640) return 2;
    if (w <= 900) return 3;
    if (w <= 1100) return 4;
    return 5;
  }

  function _stepPage(delta) {
    const items = _historyItems();
    const perPage = _columnCount();
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const current = _currentPage(items, perPage);
    const next = Math.min(totalPages, Math.max(1, current + delta));
    // 翻页后回到标准分页边界，并以该页首本书作为新锚点
    _historyPage = next;
    const first = items[(next - 1) * perPage];
    _historyAnchorKey = first ? _historyKey(first) : null;
    _renderHistory();
  }

  function _currentPage(items, perPage) {
    const idx = _anchorIndex(items);
    if (idx >= 0) return Math.floor(idx / perPage) + 1;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    return Math.min(totalPages, Math.max(1, _historyPage));
  }

  function _anchorIndex(items) {
    if (!_historyAnchorKey) return -1;
    return items.findIndex((it) => _historyKey(it) === _historyAnchorKey);
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

  /** 元信息区：最多展示 maxRows 行，超出部分只进浮窗 */
  function _metaBlock(entries, maxRows) {
    if (!entries.length) return '';
    const limit = maxRows || entries.length;
    const shown = entries.slice(0, limit);
    const hasMore = entries.length > limit;
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

  function _metaRows(meta) {
    return _metaBlock(Object.entries(meta || {}), 3);
  }

  /** 只有真的被省略（出现 ...）时才挂浮窗 */
  function _applyTipVisibility(root) {
    if (!root) return;
    root.querySelectorAll('.book-meta').forEach((block) => {
      const hasMore = !!block.querySelector('.book-meta-more');
      const truncated = Array.from(block.querySelectorAll('.book-meta-row .meta-val'))
        .some((el) => el.scrollWidth > el.clientWidth + 1);
      block.classList.toggle('has-tip', hasMore || truncated);
    });
    root.querySelectorAll('.book-title, .history-title').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) el.title = el.textContent;
      else el.removeAttribute('title');
    });
  }

  function _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
    _applyTipVisibility(grid);
  }

  function _historyKey(item) {
    const book = _bookForHistory(item);
    return (book && book.id) || item.bookName || item.bookId;
  }

  function _historyItems() {
    const seen = new Set();
    const items = [];
    for (const item of ReadingHistory.list()) {
      const key = _historyKey(item);
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
    const entries = [['最后阅读位置', docLabel]];
    const time = _formatTime(item.updatedAt);
    if (time) entries.push(['最后阅读时间', time]);
    return '<button type="button" class="history-card" data-book-id="' + _esc(openId) + '">' +
      '<div class="history-cover">' + _coverHtml(coverBook, 'history') + '</div>' +
      '<div class="history-info">' +
      '<div class="history-title">' + _esc(name) + '</div>' +
      _metaBlock(entries) +
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
    const paged = document.getElementById('history-paged');
    const pagination = document.getElementById('history-pagination');
    const moreBtn = document.getElementById('history-more-btn');
    if (!section || !preview || !paged || !pagination) return;

    const items = _historyItems();
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const perPage = _columnCount();

    if (moreBtn) {
      moreBtn.hidden = items.length <= perPage;
      moreBtn.textContent = _historyExpanded ? '收起' : '更多';
    }

    if (!_historyExpanded || items.length <= perPage) {
      paged.hidden = true;
      pagination.hidden = true;
      preview.hidden = false;
      preview.innerHTML = items.slice(0, perPage).map(_historyItemHtml).join('');
      _bindHistoryClicks(preview);
      _applyTipVisibility(preview);
      return;
    }

    preview.hidden = true;
    paged.hidden = false;
    pagination.hidden = false;

    // 缩放后以当前页首本书为锚点续展，页码按新的每页数重算
    const anchorIdx = _anchorIndex(items);
    const start = anchorIdx >= 0 ? anchorIdx : (_historyPage - 1) * perPage;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const page = _currentPage(items, perPage);
    _historyPage = page;

    paged.innerHTML = items.slice(start, start + perPage).map(_historyItemHtml).join('');
    _bindHistoryClicks(paged);
    _applyTipVisibility(paged);

    const info = document.getElementById('history-page-info');
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');
    if (info) info.textContent = '第 ' + page + ' / ' + totalPages + ' 页';
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;

    if (anchorIdx < 0) {
      const first = items[start];
      _historyAnchorKey = first ? _historyKey(first) : null;
    }
  }

  function refreshHistory() {
    _renderHistory();
  }

  return { init, load, filter, refreshHistory };
})();
