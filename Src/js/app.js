const App = (() => {
  const HOME_PATH = '#';

  let _bookId = '';
  let _bookMeta = null;
  let _hasHomeReadme = false;
  let _treeLoadedFor = '';
  let _currentDocPath = null;
  let _previousHash = null;
  let _previousRouteKey = null;
  let _scrollPositions = {};
  let _isPopState = false;
  let _isNavClick = false;
  let _pendingHistoryScroll = null;
  let _scrollTimer = null;
  let _resumeBookId = null;

  function isBookshelf() {
    return document.body.classList.contains('view-bookshelf');
  }

  function getBookId() {
    return _bookId;
  }

  function setNavClick(val) {
    _isNavClick = val;
  }

  async function init() {
    DocRenderer.init();
    Search.init();
    ThemeSwitcher.init();
    Bookshelf.init((bookId) => {
      window.location.hash = '#book/' + encodeURIComponent(bookId);
    });
    _setupSidebarToggle();
    _setupMobileDefaults();
    _setupBackToTop();
    _setupResumeModal();
    _setupScrollRecord();
    _setupTopbarHeight();

    document.getElementById('site-title').addEventListener('click', (e) => {
      if (isBookshelf()) return;
      e.preventDefault();
      window.location.hash = '#home';
    });

    window.addEventListener('popstate', () => { _isPopState = true; });
    window.addEventListener('hashchange', _onHashChange);
    await _onHashChange();
  }

  function _setupSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar');
    const navTree = document.getElementById('nav-tree');

    toggle.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
    overlay.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
    });

    sidebar.addEventListener('wheel', (e) => {
      if (!navTree.contains(e.target)) {
        e.preventDefault();
        return;
      }
      const atTop = navTree.scrollTop <= 0 && e.deltaY < 0;
      const atBottom = navTree.scrollTop + navTree.clientHeight >= navTree.scrollHeight && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    }, { passive: false });

    let touchStartY = 0;
    sidebar.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    sidebar.addEventListener('touchmove', (e) => {
      if (!navTree.contains(e.target)) {
        e.preventDefault();
        return;
      }
      const deltaY = touchStartY - e.touches[0].clientY;
      const atTop = navTree.scrollTop <= 0 && deltaY < 0;
      const atBottom = navTree.scrollTop + navTree.clientHeight >= navTree.scrollHeight && deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    }, { passive: false });
  }

  function _setupMobileDefaults() {
    if (window.innerWidth <= 768) {
      document.body.classList.remove('sidebar-open');
    }
  }

  function _setupBackToTop() {
    const btnTop = document.createElement('button');
    btnTop.id = 'back-to-top';
    btnTop.setAttribute('aria-label', '回到顶部');
    btnTop.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none">' +
      '<path d="M10 4v12M5 9l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    document.body.appendChild(btnTop);
    btnTop.addEventListener('click', () => _scrollToTop());
    window.addEventListener('scroll', () => {
      btnTop.classList.toggle('visible', window.scrollY > 300);
    }, { passive: true });
  }

  function _setupResumeModal() {
    document.getElementById('resume-yes').addEventListener('click', () => {
      const bookId = _resumeBookId;
      const hist = bookId ? ReadingHistory.get(bookId) : null;
      _hideResumeModal();
      if (!bookId || !hist) return;
      _pendingHistoryScroll = { y: hist.scrollY || 0 };
      window.location.replace(_bookHref(bookId, hist.docPath, hist.anchor));
    });
    document.getElementById('resume-no').addEventListener('click', () => {
      const bookId = _resumeBookId;
      _hideResumeModal();
      if (bookId) window.location.replace(_landingHash(bookId));
    });
  }

  function _setupScrollRecord() {
    window.addEventListener('scroll', () => {
      if (isBookshelf() || !_bookId || !_currentDocPath) return;
      clearTimeout(_scrollTimer);
      _scrollTimer = setTimeout(() => {
        ReadingHistory.updateScroll(_bookId, window.scrollY);
      }, 300);
    }, { passive: true });
  }

  function _showResumeModal(bookId, hist) {
    _resumeBookId = bookId;
    const label = _isHomePath(hist.docPath) ? '首页' : (hist.docTitle || hist.docPath || '');
    document.getElementById('resume-doc-label').textContent = label;
    document.getElementById('resume-modal').hidden = false;
  }

  function _hideResumeModal() {
    document.getElementById('resume-modal').hidden = true;
    _resumeBookId = null;
  }

  function _isHomePath(docPath) {
    return docPath === HOME_PATH || docPath === '__home';
  }

  function _normDocPath(docPath) {
    return _isHomePath(docPath) ? HOME_PATH : docPath;
  }

  function _bookHref(bookId, docPath, anchor) {
    const path = 'book/' + encodeURIComponent(bookId) + '/' +
      String(_normDocPath(docPath) || '').split('/').map((s) => encodeURIComponent(s)).join('/');
    return '#' + path + (anchor ? '__' + encodeURIComponent(anchor) : '');
  }

  function _splitRouteAnchor(decoded) {
    const idx = decoded.indexOf('__');
    if (idx === -1) return { route: decoded, anchor: null };
    return { route: decoded.slice(0, idx), anchor: decoded.slice(idx + 2) || null };
  }

  function _landingHash(bookId) {
    if (_hasHomeReadme) return _bookHref(bookId, HOME_PATH);
    const first = Nav.getFirstDocPath();
    if (first) return _bookHref(bookId, first);
    return _bookHref(bookId, HOME_PATH);
  }

  function _setupTopbarHeight() {
    const topbar = document.getElementById('topbar');
    if (!topbar || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const h = Math.ceil(topbar.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--topbar-height', h + 'px');
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(topbar);
  }

  function _parseHash() {
    const hash = window.location.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const pathPart = qIdx === -1 ? hash : hash.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : hash.slice(qIdx + 1);

    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch (_) {
      decoded = pathPart;
    }

    const { route, anchor } = _splitRouteAnchor(decoded);

    if (!route || route === 'home') {
      return { view: 'shelf', fullHash: decoded || 'home' };
    }

    if (route.startsWith('book/')) {
      const rest = route.slice(5);
      const segs = rest.split('/').filter(Boolean);
      const bookId = segs[0] || '';
      const docSegs = segs.slice(1);

      if (queryStr && docSegs[0] === 'search') {
        const params = new URLSearchParams(queryStr);
        return { view: 'search', bookId, query: params.get('q') || '', fullHash: decoded };
      }
      if (docSegs.length === 0) {
        return { view: 'enter', bookId, fullHash: decoded };
      }
      return {
        view: 'doc',
        bookId,
        docPath: _normDocPath(docSegs.join('/')),
        anchor,
        fullHash: decoded
      };
    }

    return { view: 'shelf', fullHash: decoded || 'home' };
  }

  function _setView(mode, bookName) {
    const title = document.getElementById('site-title');
    const searchInput = document.getElementById('top-search-input');
    const shelf = document.getElementById('bookshelf-view');
    const reader = document.getElementById('reader-view');
    const bookRow = document.getElementById('topbar-book-row');
    const bookTitle = document.getElementById('book-title-bar');

    if (mode === 'shelf') {
      document.body.classList.remove('view-reader', 'sidebar-open');
      document.body.classList.add('view-bookshelf');
      shelf.hidden = false;
      reader.hidden = true;
      title.textContent = 'Markdown 阅读器';
      title.href = '#home';
      searchInput.placeholder = '搜索书籍名称、作者...';
      if (bookRow) bookRow.hidden = true;
    } else {
      document.body.classList.remove('view-bookshelf');
      document.body.classList.add('view-reader');
      if (window.innerWidth > 768) document.body.classList.add('sidebar-open');
      shelf.hidden = true;
      reader.hidden = false;
      title.textContent = '返回书架';
      title.href = '#home';
      searchInput.placeholder = '搜索文档内容...';
      if (bookRow) bookRow.hidden = false;
      if (bookTitle) bookTitle.textContent = bookName || (_bookMeta && _bookMeta.name) || '';
    }
  }

  function _getRouteKey(route) {
    if (route.view === 'shelf') return 'home';
    if (route.view === 'search') return 'search:' + route.bookId + ':' + (route.query || '');
    return (route.bookId || '') + '/' + (route.docPath || '');
  }

  function _resolveScroll(fullHash, anchor) {
    if (_pendingHistoryScroll) {
      const y = _pendingHistoryScroll.y;
      _pendingHistoryScroll = null;
      setTimeout(() => window.scrollTo({ top: y, behavior: 'instant' }), 50);
      return;
    }
    if (_isPopState && !_isNavClick) {
      const saved = _scrollPositions[fullHash];
      if (saved !== undefined) {
        setTimeout(() => window.scrollTo({ top: saved, behavior: 'instant' }), 50);
        return;
      }
    }
    if (anchor) _scrollToAnchor(anchor);
    else _scrollToTop();
  }

  function _commitNavigation(fullHash, routeKey) {
    _previousHash = fullHash;
    _previousRouteKey = routeKey || null;
    _isPopState = false;
    _isNavClick = false;
  }

  async function ensureBook(bookId) {
    if (_treeLoadedFor === bookId && _bookMeta) return true;
    try {
      const [metaResp, treeResp] = await Promise.all([
        fetch('/api/books/' + encodeURIComponent(bookId)),
        fetch('/api/books/' + encodeURIComponent(bookId) + '/tree')
      ]);
      if (!metaResp.ok || !treeResp.ok) throw new Error('load book failed');
      _bookMeta = await metaResp.json();
      const treeData = await treeResp.json();
      _bookId = bookId;
      _hasHomeReadme = !!treeData.hasHomeReadme;
      Nav.init(treeData.tree || [], { hasHomeReadme: _hasHomeReadme, bookId });
      _treeLoadedFor = bookId;
      return true;
    } catch (err) {
      console.error(err);
      document.getElementById('doc-content').innerHTML =
        '<p style="color:red;">无法加载书籍，请返回书架。</p>';
      _hideLoading();
      return false;
    }
  }

  async function _onHashChange() {
    const route = _parseHash();
    const fullHash = route.fullHash || 'home';
    const routeKey = _getRouteKey(route);
    const prevRouteKey = _previousRouteKey;

    if (_previousHash !== null) {
      _scrollPositions[_previousHash] = window.scrollY;
      if (_bookId && _currentDocPath) {
        ReadingHistory.record({
          bookId: _bookId,
          bookName: _bookMeta && _bookMeta.name,
          docPath: _currentDocPath,
          docTitle: _docTitle(_currentDocPath),
          scrollY: window.scrollY
        });
      }
    }

    if (route.view === 'shelf') {
      _hideResumeModal();
      _currentDocPath = null;
      _setView('shelf');
      _hideLoading();
      await Bookshelf.load();
      const top = document.getElementById('top-search-input');
      const page = document.getElementById('bookshelf-search-input');
      if (top && page && !page.value) top.value = '';
      _resolveScroll(fullHash, null);
      _commitNavigation(fullHash, routeKey);
      return;
    }

    if (!route.bookId) {
      window.location.hash = '#home';
      return;
    }

    if (route.view === 'enter') {
      const ok = await ensureBook(route.bookId);
      if (!ok) {
        _commitNavigation(fullHash, routeKey);
        return;
      }
      const hist = ReadingHistory.get(route.bookId);
      if (hist && hist.docPath) {
        _setView('shelf');
        _showResumeModal(route.bookId, hist);
        _hideLoading();
        _commitNavigation(fullHash, routeKey);
        return;
      }
      window.location.replace(_landingHash(route.bookId));
      return;
    }

    _setView('reader', _bookMeta && _bookId === route.bookId ? _bookMeta.name : '');
    const ok = await ensureBook(route.bookId);
    if (!ok) {
      _commitNavigation(fullHash, routeKey);
      return;
    }
    _setView('reader', _bookMeta.name);
    _hideResumeModal();

    if (route.view === 'search') {
      _currentDocPath = null;
      Nav.clearHighlight();
      _hideLoading();
      const top = document.getElementById('top-search-input');
      if (top) top.value = route.query || '';
      if (route.query) await Search.executeSearch(route.bookId, route.query);
      _resolveScroll(fullHash, null);
      _commitNavigation(fullHash, routeKey);
      return;
    }

    if (prevRouteKey === routeKey && !_isNavClick && !_pendingHistoryScroll) {
      _resolveScroll(fullHash, route.anchor);
      _commitNavigation(fullHash, routeKey);
      return;
    }

    _currentDocPath = route.docPath;
    Nav.highlight(route.docPath);
    await _loadDoc(route.bookId, route.docPath);
    ReadingHistory.record({
      bookId: route.bookId,
      bookName: _bookMeta && _bookMeta.name,
      docPath: route.docPath,
      docTitle: _docTitle(route.docPath),
      scrollY: 0
    });
    Bookshelf.refreshHistory();
    _resolveScroll(fullHash, route.anchor);
    _commitNavigation(fullHash, routeKey);
  }

  function _docTitle(docPath) {
    const files = Nav.getFlatFiles();
    const cur = files.find((f) => f.path === docPath);
    return cur ? cur.title : docPath;
  }

  async function _loadDoc(bookId, docPath) {
    _showLoading();
    try {
      const encoded = String(docPath).split('/').map((s) => encodeURIComponent(s)).join('/');
      const resp = await fetch('/api/books/' + encodeURIComponent(bookId) + '/doc/' + encoded);
      if (!resp.ok) throw new Error('Document not found');
      const markdown = await resp.text();
      const container = document.getElementById('doc-content');
      const pathParts = _isHomePath(docPath) ? [] : docPath.split('/');
      const basePath = pathParts.length ? pathParts.slice(0, -1) : [];
      const route = 'book/' + bookId + '/' + docPath;
      container.innerHTML = DocRenderer.render(markdown, {
        basePath: basePath,
        route: route,
        hashPrefix: 'book/' + bookId,
        bookId: bookId
      });
      _renderPrevNext(docPath, container, bookId);
      _hideLoading();
      await DocRenderer.postRender(container);
    } catch (err) {
      document.getElementById('doc-content').innerHTML =
        '<div style="text-align:center;padding:60px 20px;color:#6b7280;">' +
        '<p style="font-size:1.2rem;">文档未找到</p>' +
        '<p style="margin-top:8px;"><a href="#home">返回书架</a></p>' +
        '</div>';
      _hideLoading();
    }
  }

  function _createPrevNextNav(prev, next) {
    const nav = document.createElement('nav');
    nav.className = 'doc-prev-next';

    if (prev) {
      const a = document.createElement('a');
      a.href = prev.href;
      a.className = 'doc-prev-next-link prev';
      a.innerHTML = '<span class="doc-prev-next-label">上一篇</span>' +
        '<span class="doc-prev-next-title">' + _escHtml(prev.title) + '</span>';
      a.addEventListener('click', () => App.setNavClick(true));
      nav.appendChild(a);
    } else {
      nav.appendChild(document.createElement('span'));
    }

    if (next) {
      const a = document.createElement('a');
      a.href = next.href;
      a.className = 'doc-prev-next-link next';
      a.innerHTML = '<span class="doc-prev-next-label">下一篇</span>' +
        '<span class="doc-prev-next-title">' + _escHtml(next.title) + '</span>';
      a.addEventListener('click', () => App.setNavClick(true));
      nav.appendChild(a);
    } else {
      nav.appendChild(document.createElement('span'));
    }

    return nav;
  }

  function _renderPrevNext(docPath, container, bookId) {
    const files = Nav.getFlatFiles();
    const idx = files.findIndex((f) => f.path === docPath);
    let prev = null;
    let next = null;

    if (idx >= 0) {
      if (idx > 0) {
        prev = { href: _bookHref(bookId, files[idx - 1].path), title: files[idx - 1].title };
      }
      if (idx < files.length - 1) {
        next = { href: _bookHref(bookId, files[idx + 1].path), title: files[idx + 1].title };
      }
    }

    if (!prev) {
      if (_isHomePath(docPath)) {
        prev = { href: '#home', title: '返回书架' };
      } else if (_hasHomeReadme) {
        prev = { href: _bookHref(bookId, HOME_PATH), title: '返回首页' };
      } else {
        prev = { href: '#home', title: '返回书架' };
      }
    }

    const top = _createPrevNextNav(prev, next);
    top.classList.add('doc-prev-next-top');
    container.insertBefore(top, container.firstChild);
    container.appendChild(_createPrevNextNav(prev, next));
  }

  function _escHtml(str) {
    const el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  function _showLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.remove('hidden');
  }

  function _hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
  }

  function _scrollToTop() {
    const content = document.getElementById('content');
    if (content) content.scrollTo({ top: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function _scrollToAnchor(anchor) {
    setTimeout(() => {
      let decoded = anchor;
      try { decoded = decodeURIComponent(anchor); } catch (_) {}
      let target = document.getElementById(decoded);
      if (!target) {
        const lower = decoded.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
        target = document.getElementById(lower);
      }
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  return { init, setNavClick, isBookshelf, getBookId };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
