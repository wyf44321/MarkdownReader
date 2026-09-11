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
    const bookName = entry.bookName || prev.bookName || entry.bookId;
    data.books[entry.bookId] = {
      bookId: entry.bookId,
      bookName: bookName,
      coverUrl: entry.coverUrl != null ? entry.coverUrl : prev.coverUrl || null,
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

  function remove(bookId) {
    if (!bookId) return;
    const data = _load();
    if (!data.books[bookId]) return;
    delete data.books[bookId];
    _save(data);
  }

  function retain(bookList) {
    const books = Array.isArray(bookList) ? bookList : [];
    const keep = new Set();
    const byName = new Map();
    for (const book of books) {
      if (!book || !book.id) continue;
      keep.add(book.id);
      const name = book.name;
      if (!name) continue;
      const arr = byName.get(name) || [];
      arr.push(book);
      byName.set(name, arr);
    }
    const data = _load();
    let changed = false;
    for (const id of Object.keys(data.books)) {
      if (keep.has(id)) continue;
      const entry = data.books[id];
      const matches = entry && entry.bookName ? byName.get(entry.bookName) : null;
      if (matches && matches.length === 1) {
        const destId = matches[0].id;
        const dest = data.books[destId];
        if (!dest || (entry.updatedAt || 0) >= (dest.updatedAt || 0)) {
          data.books[destId] = Object.assign({}, entry, { bookId: destId });
        }
      }
      delete data.books[id];
      changed = true;
    }
    if (changed) _save(data);
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

  return { record, updateScroll, get, remove, retain, list, groupByTime };
})();
