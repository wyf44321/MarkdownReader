/**
 * 阅读历史：按书记录最后文档与滚动位置，存在 localStorage。
 */
const ReadingHistory = (() => {
  const STORAGE_KEY = 'mdr-reading-history';
  const DAY = 24 * 60 * 60 * 1000;

  const BUCKETS = [
    { id: 'week', label: '一周内', max: 7 * DAY },
    { id: 'month', label: '一月内', max: 30 * DAY },
    { id: 'quarter', label: '三月内', max: 90 * DAY },
    { id: 'half', label: '半年内', max: 180 * DAY },
    { id: 'year', label: '一年内', max: 365 * DAY },
    { id: 'older', label: '很久以前', max: Infinity }
  ];

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, books: {} };
      const data = JSON.parse(raw);
      if (!data || typeof data.books !== 'object') return { version: 1, books: {} };
      return data;
    } catch {
      return { version: 1, books: {} };
    }
  }

  function _save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('无法写入阅读历史', err);
    }
  }

  function record(entry) {
    if (!entry || !entry.bookId) return;
    const data = _load();
    const prev = data.books[entry.bookId] || {};
    data.books[entry.bookId] = {
      bookId: entry.bookId,
      bookName: entry.bookName || prev.bookName || entry.bookId,
      docPath: entry.docPath != null ? entry.docPath : prev.docPath,
      docTitle: entry.docTitle != null ? entry.docTitle : prev.docTitle,
      scrollY: entry.scrollY != null ? entry.scrollY : (prev.scrollY || 0),
      anchor: entry.anchor != null ? entry.anchor : prev.anchor || '',
      updatedAt: Date.now()
    };
    _save(data);
  }

  function updateScroll(bookId, scrollY) {
    if (!bookId) return;
    const data = _load();
    const prev = data.books[bookId];
    if (!prev) return;
    prev.scrollY = scrollY;
    prev.updatedAt = Date.now();
    _save(data);
  }

  function get(bookId) {
    if (!bookId) return null;
    return _load().books[bookId] || null;
  }

  function list() {
    const books = _load().books;
    return Object.values(books).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function groupByTime(items) {
    const now = Date.now();
    const groups = BUCKETS.map((b) => ({ id: b.id, label: b.label, items: [] }));
    for (const item of items) {
      const age = now - (item.updatedAt || 0);
      for (let i = 0; i < BUCKETS.length; i++) {
        if (age < BUCKETS[i].max) {
          groups[i].items.push(item);
          break;
        }
      }
    }
    return groups.filter((g) => g.items.length > 0);
  }

  return { record, updateScroll, get, list, groupByTime };
})();
