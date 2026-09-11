const DocRenderer = (() => {
  let _basePath = [];
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
    _basePath = opts.basePath || [];
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

    const isDirectoryLink = pathPart.endsWith('/');
    const segments = pathPart.split('/');
    const resolved = [..._basePath];

    for (const seg of segments) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') {
        resolved.pop();
      } else {
        resolved.push(seg);
      }
    }

    if (isDirectoryLink) {
      resolved.push('README');
    }

    const docPath = resolved.join('/').replace(/\.md$/i, '');
    return { href: _bookHash(docPath, anchor), external: false };
  }

  function _resolveImageSrc(href) {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
      return href;
    }
    if (href.startsWith('/')) {
      return href;
    }

    const segments = href.split('/');
    const resolved = [..._basePath];
    for (const seg of segments) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') {
        resolved.pop();
      } else {
        resolved.push(seg);
      }
    }

    if (_bookId) {
      return '/content/' + encodeURIComponent(_bookId) + '/' +
        resolved.map((s) => encodeURIComponent(s)).join('/');
    }
    return '/' + resolved.join('/');
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
