/**
 * 主题切换：持久化到 localStorage（独立 key，不与其他阅读器串台），
 * 同步 highlight.js 与 mermaid。
 */
const ThemeSwitcher = (() => {
  const STORAGE_KEY = 'mdr-theme';
  const HLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/';
  const DARK_THEMES = new Set(['dark', 'dim', 'nord', 'solarized-dark']);

  const THEME_HLJS_MAP = {
    'light': 'github.min.css',
    'dark': 'github-dark.min.css',
    'dim': 'github-dark-dimmed.min.css',
    'nord': 'nord.min.css',
    'solarized-light': 'stackoverflow-light.min.css',
    'solarized-dark': 'stackoverflow-dark.min.css'
  };

  const THEME_MERMAID_MAP = {
    'light': 'default',
    'dark': 'dark',
    'dim': 'dark',
    'nord': 'dark',
    'solarized-light': 'default',
    'solarized-dark': 'dark'
  };

  const SVG_SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="5"/>' +
    '<line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>' +
    '<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>' +
    '<line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>' +
    '<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>' +
    '</svg>';

  const SVG_MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' +
    '</svg>';

  let _currentTheme = localStorage.getItem(STORAGE_KEY) || 'light';

  function init() {
    _currentTheme = localStorage.getItem(STORAGE_KEY) || 'light';
    _applyTheme(_currentTheme, false);

    const toggle = document.getElementById('theme-toggle');
    const menu = document.getElementById('theme-menu');

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-menu-item');
      if (!btn) return;
      const theme = btn.dataset.theme;
      if (theme) {
        setTheme(theme);
        menu.classList.remove('open');
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.theme-switcher')) {
        menu.classList.remove('open');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.classList.remove('open');
    });
  }

  function setTheme(theme) {
    _currentTheme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    _applyTheme(theme, true);
  }

  function _applyTheme(theme, animate) {
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    _updateToggleIcon(theme);
    _updateActiveMenuItem(theme);
    _updateHljsTheme(theme);

    if (animate) {
      _reinitMermaid(theme);
    }
  }

  function _updateToggleIcon(theme) {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.innerHTML = DARK_THEMES.has(theme) ? SVG_MOON : SVG_SUN;
    }
  }

  function _updateActiveMenuItem(theme) {
    const items = document.querySelectorAll('.theme-menu-item');
    items.forEach(item => {
      item.classList.toggle('active', item.dataset.theme === theme);
    });
  }

  function _updateHljsTheme(theme) {
    const link = document.getElementById('hljs-theme');
    if (!link) return;
    const cssFile = THEME_HLJS_MAP[theme] || THEME_HLJS_MAP['light'];
    const newHref = HLJS_CDN + cssFile;
    if (link.getAttribute('href') !== newHref) {
      link.setAttribute('href', newHref);
    }
  }

  function _reinitMermaid(theme) {
    const mermaidTheme = THEME_MERMAID_MAP[theme] || 'default';
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: mermaidTheme,
        securityLevel: 'loose'
      });
      const nodes = document.querySelectorAll('pre.mermaid[data-processed]');
      if (nodes.length > 0) {
        nodes.forEach(node => {
          node.removeAttribute('data-processed');
          const source = node.getAttribute('data-mermaid-source');
          if (source) node.textContent = source;
        });
        mermaid.run({ nodes: Array.from(nodes) }).catch(() => {});
      }
    } catch (_) {}
  }

  function getMermaidTheme() {
    return THEME_MERMAID_MAP[_currentTheme] || 'default';
  }

  function isDark() {
    return DARK_THEMES.has(_currentTheme);
  }

  return { init, setTheme, getMermaidTheme, isDark };
})();
