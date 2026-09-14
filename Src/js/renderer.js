const DocRenderer = (() => {
  let _baseDirRel = '';
  let _contentRootBase = '';
  let _homeRel = '';
  let _currentRoute = 'home';
  let _hashPrefix = '';
  let _bookId = '';
  let _headingIdCounts = {};

  function init() {
    const renderer = new marked.Renderer();

    renderer.code = function (code, lang) {
      if (lang === 'mermaid') {
        return '<pre class="mermaid">' + _escapeHtml(code) + '</pre>';
      }
      if (lang === '经文' || lang === 'sutra') {
        return '<pre class="sutra"><code>' + _escapeHtml(code) + '</code></pre>';
      }
      let highlighted;
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } catch (_) {
          highlighted = hljs.highlightAuto(code).value;
        }
      } else if (lang) {
        highlighted = hljs.highlightAuto(code).value;
      } else {
        highlighted = _escapeHtml(code);
      }
      const langClass = lang ? ' language-' + lang : '';
      return '<pre><code class="hljs' + langClass + '">' + highlighted + '</code></pre>';
    };

    renderer.heading = function (text, level) {
      const slug = _slugify(text);
      let id = slug;
      if (_headingIdCounts[slug] !== undefined) {
        _headingIdCounts[slug]++;
        id = slug + '-' + _headingIdCounts[slug];
      } else {
        _headingIdCounts[slug] = 0;
      }
      return '<h' + level + ' id="' + _escapeAttr(id) + '">' + text + '</h' + level + '>\n';
    };

    renderer.link = function (href, title, text) {
      if (!href) return text;
      const resolved = _resolveLink(href);
      const titleAttr = title ? ' title="' + _escapeAttr(title) + '"' : '';
      if (resolved.external) {
        return '<a href="' + _escapeAttr(resolved.href) + '"' + titleAttr +
          ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
      }
      return '<a href="' + _escapeAttr(resolved.href) + '"' + titleAttr + '>' + text + '</a>';
    };

    renderer.image = function (href, title, text) {
      if (!href) return '';
      const src = _resolveImageSrc(href);
      const titleAttr = title ? ' title="' + _escapeAttr(title) + '"' : '';
      return '<img src="' + _escapeAttr(src) + '" alt="' + _escapeAttr(text || '') + '"' + titleAttr + ' loading="lazy">';
    };

    marked.setOptions({
      renderer: renderer,
      gfm: true,
      breaks: false,
      pedantic: false,
      smartLists: true,
      smartypants: false
    });

    _applyMermaidTheme();
  }

  function _applyMermaidTheme() {
    const mermaidTheme = (typeof ThemeSwitcher !== 'undefined')
      ? ThemeSwitcher.getMermaidTheme()
      : 'default';
    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      securityLevel: 'loose'
    });
  }

  function render(markdown, opts) {
    const basePath = opts.basePath || [];
    _baseDirRel = opts.baseDirRel != null ? String(opts.baseDirRel) : basePath.join('/');
    _contentRootBase = opts.contentRootBase || '';
    _homeRel = _stripMdExt(opts.homeRel || '');
    _currentRoute = opts.route || 'home';
    _hashPrefix = opts.hashPrefix || '';
    _bookId = opts.bookId || '';
    _headingIdCounts = {};
    return marked.parse(markdown);
  }

  async function postRender(container) {
    const mermaidNodes = container.querySelectorAll('pre.mermaid');
    if (mermaidNodes.length > 0) {
      mermaidNodes.forEach(node => {
        if (!node.getAttribute('data-mermaid-source')) {
          node.setAttribute('data-mermaid-source', node.textContent);
        }
      });
      try {
        _applyMermaidTheme();
        await mermaid.run({ nodes: mermaidNodes });
      } catch (e) {
        console.warn('Mermaid rendering error:', e);
      }
    }
  }

  function _slugify(text) {
    return text
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function _stripMdExt(p) {
    return String(p || '').replace(/\.md$/i, '');
  }

  function _posixNormalize(p) {
    const isAbs = String(p).startsWith('/');
    const segs = [];
    for (const seg of String(p).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (segs.length && segs[segs.length - 1] !== '..') segs.pop();
        else if (!isAbs) segs.push('..');
      } else {
        segs.push(seg);
      }
    }
    const body = segs.join('/');
    return isAbs ? '/' + body : body;
  }

  function _posixRelative(from, to) {
    const fromParts = _posixNormalize(from).split('/').filter(Boolean);
    const toParts = _posixNormalize(to).split('/').filter(Boolean);
    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
    const ups = fromParts.length - i;
    const rest = toParts.slice(i);
    const rel = (ups ? Array(ups).fill('..') : []).concat(rest).join('/');
    return rel;
  }

  function _joinBookRel(hrefPath) {
    const rootName = _contentRootBase || '_root';
    const bookRoot = '/' + rootName;
    const from = _posixNormalize(bookRoot + '/' + (_baseDirRel || ''));
    const target = String(hrefPath).startsWith('/')
      ? _posixNormalize(hrefPath)
      : _posixNormalize(from + '/' + hrefPath);
    return _posixRelative(bookRoot, target);
  }

  function _isHomeRel(docPath) {
    const a = _stripMdExt(docPath).replace(/\\/g, '/');
    if (a === '#' || a === '__home') return true;
    const b = _homeRel.replace(/\\/g, '/');
    return !!b && a === b;
  }

  function _bookHash(docPath, anchor) {
    const prefix = _hashPrefix || (_bookId ? 'book/' + _bookId : '');
    const pathPart = prefix ? prefix + '/' + docPath : docPath;
    return '#' + pathPart + (anchor ? '__' + anchor : '');
  }

  function _resolveLink(href) {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
      return { href: href, external: true };
    }

    if (href.startsWith('#')) {
      const fragment = href.substring(1);
      return { href: '#' + _currentRoute + '__' + fragment, external: false };
    }

    let anchor = '';
    let pathPart = href;
    const hashIdx = href.indexOf('#');
    if (hashIdx !== -1) {
      anchor = href.substring(hashIdx + 1);
      pathPart = href.substring(0, hashIdx);
    }

    if (pathPart.endsWith('/')) pathPart += 'README.md';
    const bookRel = _stripMdExt(_joinBookRel(pathPart));
    const docPath = _isHomeRel(bookRel) ? '#' : bookRel;
    return { href: _bookHash(docPath, anchor), external: false };
  }

  function _resolveImageSrc(href) {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
      return href;
    }
    if (href.startsWith('/')) {
      return href;
    }

    const resolved = _joinBookRel(href);
    const segments = resolved.split('/').filter(Boolean);
    if (_bookId) {
      return '/content/' + encodeURIComponent(_bookId) + '/' +
        segments.map((s) => encodeURIComponent(s)).join('/');
    }
    return '/' + segments.join('/');
  }

  function _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { init, render, postRender };
})();
