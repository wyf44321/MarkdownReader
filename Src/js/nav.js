/**
 * 递归侧栏：目录点击只展开；README 用右侧按钮打开；支持双行标题。
 */
const Nav = (() => {
  let _tree = [];
  let _hasHomeReadme = false;
  let _bookId = '';
  let _navTree = null;
  let _filterInput = null;
  let _filterBound = false;

  function init(tree, opts) {
    _tree = tree || [];
    _hasHomeReadme = !!(opts && opts.hasHomeReadme);
    _bookId = (opts && opts.bookId) || '';
    _navTree = document.getElementById('nav-tree');
    _filterInput = document.getElementById('nav-search-input');
    _render();
    if (_filterInput && !_filterBound) {
      _filterInput.addEventListener('input', _onFilter);
      _filterBound = true;
    }
    if (_filterInput) _filterInput.value = '';
  }

  function _bookHref(docPath) {
    return '#book/' + encodeURIComponent(_bookId) + '/' +
      String(docPath).split('/').map((s) => encodeURIComponent(s)).join('/');
  }

  function _render() {
    _navTree.innerHTML = '';
    const frag = document.createDocumentFragment();
    if (_hasHomeReadme) {
      frag.appendChild(_buildHomeItem());
    }
    for (const node of _tree) {
      frag.appendChild(_buildNode(node, 0));
    }
    _navTree.appendChild(frag);
  }

  function _buildHomeItem() {
    const item = document.createElement('a');
    item.className = 'nav-file-item nav-home-item';
    item.href = _bookHref('#');
    item.dataset.path = '#';
    item.innerHTML = '<div class="doc-cn-name">首页</div>';
    item.addEventListener('click', () => {
      App.setNavClick(true);
      _closeMobileSidebar();
    });
    return item;
  }

  function _titleBlock(title, subtitle, titleClass, subClass) {
    let html = '<div class="' + titleClass + '">' + _esc(title) + '</div>';
    if (subtitle) {
      html += '<div class="' + subClass + '">' + _esc(subtitle) + '</div>';
    }
    return html;
  }

  function _buildNode(node, depth) {
    if (node.type === 'file') {
      const item = document.createElement('a');
      item.className = 'nav-file-item';
      item.href = _bookHref(node.path);
      item.dataset.path = node.path;
      item.style.paddingLeft = (12 + depth * 16) + 'px';
      const title = node.title || node.name;
      item.innerHTML = _titleBlock(title, node.subtitle, 'doc-cn-name', 'doc-en-name');
      item.addEventListener('click', () => {
        App.setNavClick(true);
        _closeMobileSidebar();
      });
      return item;
    }

    const dirEl = document.createElement('div');
    dirEl.className = 'nav-dir';
    dirEl.dataset.name = node.name;
    dirEl.dataset.title = node.title || node.name;
    dirEl.dataset.path = node.path || '';

    const header = document.createElement('div');
    header.className = 'nav-dir-header';
    header.style.paddingLeft = (12 + depth * 16) + 'px';

    const arrow = document.createElement('span');
    arrow.innerHTML = '<svg class="arrow" viewBox="0 0 16 16" fill="none">' +
      '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';

    const info = document.createElement('div');
    info.className = 'nav-dir-info';
    info.innerHTML = _titleBlock(node.title || node.name, node.subtitle, 'cn-name', 'en-name');

    header.appendChild(arrow);
    header.appendChild(info);

    if (node.hasReadme && node.readmePath) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-readme-btn';
      btn.title = '打开说明文档';
      btn.setAttribute('aria-label', '打开说明文档');
      btn.dataset.readmePath = node.readmePath;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
        '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' +
        '</svg>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        App.setNavClick(true);
        window.location.hash = _bookHref(node.readmePath);
        _closeMobileSidebar();
      });
      header.appendChild(btn);
    }

    header.addEventListener('click', () => {
      dirEl.classList.toggle('open');
    });

    const childList = document.createElement('div');
    childList.className = 'nav-dir-children';
    if (node.children) {
      for (const child of node.children) {
        childList.appendChild(_buildNode(child, depth + 1));
      }
    }

    dirEl.appendChild(header);
    dirEl.appendChild(childList);
    return dirEl;
  }

  function _closeMobileSidebar() {
    if (window.innerWidth <= 768) {
      document.body.classList.remove('sidebar-open');
    }
  }

  function highlight(docPath) {
    if (!_navTree) return;
    const items = _navTree.querySelectorAll('.nav-file-item');
    items.forEach((item) => item.classList.remove('active'));
    _navTree.querySelectorAll('.nav-readme-btn').forEach((btn) => btn.classList.remove('active'));
    _navTree.querySelectorAll('.nav-dir-header').forEach((el) => el.classList.remove('active-readme'));

    if (!docPath) return;

    const fileItem = _navTree.querySelector('.nav-file-item[data-path="' + CSS.escape(docPath) + '"]');
    if (fileItem) {
      fileItem.classList.add('active');
      _openAncestors(fileItem);
      fileItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    const readmeBtn = _navTree.querySelector('.nav-readme-btn[data-readme-path="' + CSS.escape(docPath) + '"]');
    if (readmeBtn) {
      readmeBtn.classList.add('active');
      const header = readmeBtn.closest('.nav-dir-header');
      if (header) header.classList.add('active-readme');
      _openAncestors(readmeBtn);
      readmeBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function _openAncestors(el) {
    let parent = el.parentElement;
    while (parent && parent !== _navTree) {
      if (parent.classList.contains('nav-dir')) parent.classList.add('open');
      parent = parent.parentElement;
    }
  }

  function clearHighlight() {
    if (!_navTree) return;
    _navTree.querySelectorAll('.nav-file-item.active').forEach((el) => el.classList.remove('active'));
    _navTree.querySelectorAll('.nav-readme-btn.active').forEach((el) => el.classList.remove('active'));
    _navTree.querySelectorAll('.nav-dir-header.active-readme').forEach((el) => el.classList.remove('active-readme'));
  }

  function _onFilter() {
    const query = _filterInput.value.trim().toLowerCase();
    const dirEls = _navTree.querySelectorAll('.nav-dir');
    const fileEls = _navTree.querySelectorAll('.nav-file-item');

    if (!query) {
      dirEls.forEach((el) => { el.style.display = ''; });
      fileEls.forEach((el) => { el.style.display = ''; });
      return;
    }

    fileEls.forEach((el) => {
      const name = el.textContent.toLowerCase();
      const pathStr = (el.dataset.path || '').toLowerCase();
      el.style.display = (name.includes(query) || pathStr.includes(query)) ? '' : 'none';
    });

    dirEls.forEach((dirEl) => {
      const dirName = (dirEl.dataset.name || '').toLowerCase();
      const dirTitle = (dirEl.dataset.title || '').toLowerCase();
      const hasVisibleChild = dirEl.querySelector('.nav-file-item:not([style*="display: none"])');
      const dirMatch = dirName.includes(query) || dirTitle.includes(query);
      if (dirMatch || hasVisibleChild) {
        dirEl.style.display = '';
        if (hasVisibleChild || dirMatch) dirEl.classList.add('open');
        if (dirMatch) {
          dirEl.querySelectorAll('.nav-file-item').forEach((el) => { el.style.display = ''; });
        }
      } else {
        dirEl.style.display = 'none';
      }
    });
  }

  function getTree() { return _tree; }

  function _flattenFiles(nodes, out) {
    for (const node of nodes) {
      if (node.type === 'file') {
        out.push({
          name: node.title || node.name,
          path: node.path,
          title: node.title || node.name
        });
      } else if (node.children) {
        _flattenFiles(node.children, out);
      }
    }
  }

  function getFlatFiles() {
    const out = [];
    if (_hasHomeReadme) {
      out.push({ name: '首页', path: '#', title: '首页' });
    }
    _flattenFiles(_tree, out);
    return out;
  }

  function getFirstDocPath() {
    const files = getFlatFiles();
    if (!files.length) return null;
    if (files[0].path === '#') return files[0].path;
    return files[0].path;
  }

  function _esc(str) {
    const el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  return { init, highlight, clearHighlight, getTree, getFlatFiles, getFirstDocPath };
})();
