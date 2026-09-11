const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { exec } = require('child_process');
const minimatch = require('minimatch');
const stripJsonComments = require('strip-json-comments');

const app = express();
const ROOT = path.resolve(__dirname, '..');
const ALWAYS_IGNORED = new Set(['.git', '.vscode', 'node_modules']);

const READER_ARRAY_FIELDS = ['booksRoot', 'booksCfg'];
const BOOK_SHAPE_FIELDS = ['name', 'path', 'cover', 'meta', 'exclude', 'features'];

let booksRoots = [];
let extraBookConfigs = [];
let booksCfgWatchDirs = [];
let relayConfigFiles = [];
let booksRootError = null;
/** @type {Map<string, object>} */
let books = new Map();
const h1Cache = new Map();

let configDirty = true;
let configRevision = 0;
let configFingerprint = '';
let configWatchers = [];
let configWatchTimer = null;
let configDiscovering = false;
let ignoreWatchUntil = 0;

function parseJsonc(text) {
  return JSON.parse(stripJsonComments(text));
}

function firstExistingFile(dir, names) {
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      if (fs.statSync(abs).isFile()) return abs;
    } catch {
      /* 不存在则试下一个 */
    }
  }
  return null;
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function toPosix(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
}

function asStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  const s = String(value).trim();
  return s ? [s] : [];
}

function dirKey(abs) {
  try {
    return fs.realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}

function resolveExistingDirs(baseDir, rels) {
  const found = [];
  const missing = [];
  const seen = new Set();
  for (const rel of rels) {
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      missing.push(abs);
      continue;
    }
    const resolved = dirKey(abs);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    found.push(resolved);
  }
  return { found, missing };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 接力只认数组字段；字符串等其它类型一律忽略，仍以主配置为准 */
function readRelayArrays(configAbs) {
  try {
    const cfg = parseJsonc(fs.readFileSync(configAbs, 'utf8'));
    if (!isPlainObject(cfg)) return {};
    const out = {};
    for (const key of READER_ARRAY_FIELDS) {
      if (!Array.isArray(cfg[key])) continue;
      const items = cfg[key].map((v) => String(v).trim()).filter(Boolean);
      if (items.length) out[key] = items;
    }
    return out;
  } catch (err) {
    console.warn('[config] 解析 ' + configAbs + ' 失败：' + err.message);
    return {};
  }
}

function looksLikeGlob(rel) {
  return /[*?\[]/.test(String(rel || ''));
}

function collectGlobFiles(baseDir, pattern) {
  const posixPat = toPosix(pattern).replace(/^\.\//, '');
  const segs = posixPat.split('/').filter((s) => s && s !== '.');
  const prefixSegs = [];
  for (const seg of segs) {
    if (/[*?\[]/.test(seg)) break;
    prefixSegs.push(seg);
  }
  const startDir = prefixSegs.length ? path.resolve(baseDir, ...prefixSegs) : path.resolve(baseDir);
  const rest = segs.slice(prefixSegs.length);
  const maxDepth = rest.includes('**') ? Infinity : Math.max(rest.length, 1);
  const out = [];

  function visit(dir, depth) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    names.sort(naturalCompare);
    for (const name of names) {
      if (isAlwaysIgnoredName(name)) continue;
      const abs = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (stat.isDirectory()) {
        if (depth < maxDepth) visit(abs, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      const rel = toPosix(path.relative(baseDir, abs));
      if (minimatch(rel, posixPat, { dot: true })) out.push(abs);
    }
  }

  visit(startDir, 1);
  return { files: out, watchDir: startDir };
}

function resolveExistingFiles(baseDir, rels) {
  const found = [];
  const missing = [];
  const watchDirs = [];
  const seen = new Set();

  function addFile(abs) {
    try {
      if (!fs.statSync(abs).isFile()) return;
    } catch {
      return;
    }
    const resolved = dirKey(abs);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    found.push(resolved);
  }

  for (const rel of rels) {
    if (looksLikeGlob(rel)) {
      const { files, watchDir } = collectGlobFiles(baseDir, rel);
      if (watchDir) watchDirs.push(watchDir);
      if (!files.length) {
        missing.push(String(rel));
        continue;
      }
      for (const abs of files) addFile(abs);
      continue;
    }
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing.push(abs);
      continue;
    }
    addFile(abs);
  }
  return { found, missing, watchDirs };
}

/** 在某个 booksRoot 目录自身及其一层子目录里找接力用的 config.jsonc */
function findRelayConfigs(dirAbs) {
  const files = [];
  const seen = new Set();
  function add(fileAbs) {
    if (!fileAbs) return;
    const key = dirKey(fileAbs);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(fileAbs);
  }
  add(firstExistingFile(dirAbs, ['config.jsonc', 'config.json']));
  let names;
  try {
    names = fs.readdirSync(dirAbs);
  } catch {
    return files;
  }
  for (const name of names) {
    if (isAlwaysIgnoredName(name)) continue;
    const child = path.join(dirAbs, name);
    try {
      if (!fs.statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    add(firstExistingFile(child, ['config.jsonc', 'config.json']));
  }
  return files;
}

function expandReaderArrays(initialConfigAbs, mainCfg) {
  const scanRoots = [];
  const bookCfgFiles = [];
  const cfgWatchDirs = [];
  const relayConfigs = [];
  const seenDir = new Set();
  const seenBookCfg = new Set();
  const seenRelay = new Set();
  const missingRoots = [];
  const missingCfgs = [];
  const queue = [];
  const baseDir = path.dirname(initialConfigAbs);

  seenRelay.add(dirKey(initialConfigAbs));

  function addRoots(fromDir, rels) {
    const resolved = resolveExistingDirs(fromDir, rels);
    for (const m of resolved.missing) missingRoots.push(m);
    for (const dir of resolved.found) {
      if (seenDir.has(dir)) continue;
      seenDir.add(dir);
      scanRoots.push(dir);
      queue.push(dir);
    }
  }

  function addBookCfgs(fromDir, rels) {
    const resolved = resolveExistingFiles(fromDir, rels);
    for (const m of resolved.missing) missingCfgs.push(m);
    for (const dir of resolved.watchDirs || []) cfgWatchDirs.push(dir);
    for (const fileAbs of resolved.found) {
      if (seenBookCfg.has(fileAbs)) continue;
      seenBookCfg.add(fileAbs);
      bookCfgFiles.push(fileAbs);
    }
  }

  addRoots(baseDir, asStringList(mainCfg && mainCfg.booksRoot));
  if (Array.isArray(mainCfg && mainCfg.booksCfg)) {
    addBookCfgs(baseDir, asStringList(mainCfg.booksCfg));
  }

  while (queue.length) {
    const dir = queue.shift();
    for (const cfgAbs of findRelayConfigs(dir)) {
      const cfgKey = dirKey(cfgAbs);
      if (seenRelay.has(cfgKey)) continue;
      seenRelay.add(cfgKey);
      relayConfigs.push(cfgAbs);
      const arrays = readRelayArrays(cfgAbs);
      if (arrays.booksRoot) addRoots(path.dirname(cfgAbs), arrays.booksRoot);
      if (arrays.booksCfg) addBookCfgs(path.dirname(cfgAbs), arrays.booksCfg);
    }
  }

  return { booksRoots: scanRoots, bookCfgFiles, cfgWatchDirs, relayConfigs, missingRoots, missingCfgs };
}

function rootsKey(roots) {
  return (roots || []).slice().sort().join('|');
}

function refreshHomeReadme(book) {
  book.homeReadmeAbs = null;
  for (const root of book.contentRoots) {
    const found = findReadmeFile(root);
    if (found) {
      book.homeReadmeAbs = found;
      break;
    }
  }
  book.hasHomeReadme = !!book.homeReadmeAbs;
}

function stripMdExt(name) {
  return name.replace(/\.md$/i, '');
}

function isReadmeName(name) {
  return name.toLowerCase() === 'readme.md';
}

function extractH1FromContent(content) {
  const match = String(content).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function findReadmeFile(dirAbs) {
  if (!dirAbs || !fs.existsSync(dirAbs)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dirAbs);
  } catch {
    return null;
  }
  const found = entries.find((e) => isReadmeName(e));
  if (!found) return null;
  const abs = path.join(dirAbs, found);
  try {
    if (fs.statSync(abs).isFile()) return abs;
  } catch {
    return null;
  }
  return null;
}

function getH1(absPath) {
  if (!absPath) return null;
  try {
    const st = fs.statSync(absPath);
    const cached = h1Cache.get(absPath);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.h1;
    const h1 = extractH1FromContent(fs.readFileSync(absPath, 'utf8'));
    h1Cache.set(absPath, { mtimeMs: st.mtimeMs, h1 });
    return h1;
  } catch {
    return null;
  }
}

function clearH1Under(rootAbs) {
  for (const key of h1Cache.keys()) {
    if (key === rootAbs || key.startsWith(rootAbs + path.sep)) {
      h1Cache.delete(key);
    }
  }
}

function isAlwaysIgnoredName(name) {
  return ALWAYS_IGNORED.has(name) || name.startsWith('.');
}

function isExcluded(relPosix, patterns) {
  if (!relPosix) return false;
  const p = toPosix(relPosix);
  for (const raw of patterns || []) {
    const pattern = String(raw).replace(/\\/g, '/');
    if (minimatch(p, pattern, { dot: true })) return true;
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      if (base && (p === base || minimatch(p, base, { dot: true }))) return true;
    } else if (minimatch(p, pattern.replace(/\/?$/, '') + '/**', { dot: true })) {
      return true;
    }
  }
  return false;
}

function loadReaderConfig() {
  extraBookConfigs = [];
  booksCfgWatchDirs = [];
  relayConfigFiles = [];
  const configPath = firstExistingFile(ROOT, ['config.jsonc', 'config.json']);
  if (!configPath) {
    booksRoots = [];
    booksRootError = '未找到 config.jsonc。请复制 config.example.jsonc 为 config.jsonc 并填写 booksRoot 或 booksCfg。';
    return;
  }
  try {
    const cfg = parseJsonc(fs.readFileSync(configPath, 'utf8'));
    const hasRoot = asStringList(cfg && cfg.booksRoot).length > 0;
    const hasCfg = Array.isArray(cfg && cfg.booksCfg) && asStringList(cfg.booksCfg).length > 0;
    if (!hasRoot && !hasCfg) {
      booksRoots = [];
      booksRootError = 'config.jsonc 缺少 booksRoot 或 booksCfg。';
      return;
    }
    const expanded = expandReaderArrays(configPath, cfg);
    if (!expanded.booksRoots.length && !expanded.bookCfgFiles.length) {
      booksRoots = [];
      extraBookConfigs = [];
      const miss = expanded.missingRoots.concat(expanded.missingCfgs);
      booksRootError = 'booksRoot / booksCfg 都不是有效路径：' + (miss.join('；') || '(空)');
      return;
    }
    if (expanded.missingRoots.length) {
      console.warn('[config] 忽略无效 booksRoot：' + expanded.missingRoots.join('；'));
    }
    if (expanded.missingCfgs.length) {
      console.warn('[config] 忽略无效 booksCfg：' + expanded.missingCfgs.join('；'));
    }
    booksRoots = expanded.booksRoots;
    extraBookConfigs = expanded.bookCfgFiles;
    booksCfgWatchDirs = expanded.cfgWatchDirs || [];
    relayConfigFiles = expanded.relayConfigs || [];
    booksRootError = null;
  } catch (err) {
    booksRoots = [];
    extraBookConfigs = [];
    booksCfgWatchDirs = [];
    relayConfigFiles = [];
    booksRootError = '解析 ' + path.basename(configPath) + ' 失败：' + err.message;
  }
}

function isBookConfigShape(raw) {
  if (!isPlainObject(raw)) return false;
  if (!BOOK_SHAPE_FIELDS.some((key) => raw[key] != null)) return false;
  if (raw.name != null && typeof raw.name !== 'string') return false;
  if (raw.cover != null && typeof raw.cover !== 'string') return false;
  if (raw.path != null && typeof raw.path !== 'string' && !Array.isArray(raw.path)) return false;
  if (raw.meta != null && !isPlainObject(raw.meta)) return false;
  if (raw.exclude != null && !Array.isArray(raw.exclude)) return false;
  if (raw.features != null && !isPlainObject(raw.features)) return false;
  return true;
}

function parseBookConfig(configAbs, folderName) {
  const raw = parseJsonc(fs.readFileSync(configAbs, 'utf8')) || {};
  const configDir = path.dirname(configAbs);
  const pathRels = asStringList(raw.path);
  if (!pathRels.length) pathRels.push('.');
  const { found: contentRoots, missing } = resolveExistingDirs(configDir, pathRels);
  if (!contentRoots.length) {
    throw new Error('书籍 path 都不是有效目录：' + (missing.join('；') || '(空)'));
  }
  if (missing.length) {
    console.warn('[book] ' + folderName + ' 忽略无效 path：' + missing.join('；'));
  }

  let coverAbs = null;
  if (raw.cover && String(raw.cover).trim()) {
    const coverResolved = path.resolve(configDir, String(raw.cover));
    if (fs.existsSync(coverResolved) && fs.statSync(coverResolved).isFile()) {
      coverAbs = coverResolved;
    } else {
      console.warn('[book] ' + folderName + ' 封面不存在：' + coverResolved);
    }
  }

  const features = raw.features && typeof raw.features === 'object' ? raw.features : {};
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {};
  const exclude = Array.isArray(raw.exclude) ? raw.exclude.map(String) : [];
  const book = {
    id: folderName,
    name: raw.name && String(raw.name).trim() ? String(raw.name).trim() : folderName,
    configAbs: dirKey(configAbs),
    configDir,
    contentRoots,
    coverAbs,
    hasCover: !!coverAbs,
    meta,
    exclude,
    features: {
      UseTitleAsFileName: !!features.UseTitleAsFileName,
      UseTitleAsSectionName: !!features.UseTitleAsSectionName
    },
    hasHomeReadme: false,
    homeReadmeAbs: null,
    treeCache: null,
    watchers: [],
    watchTimer: null
  };
  refreshHomeReadme(book);
  return book;
}

function stripConfigExt(name) {
  return String(name).replace(/\.(jsonc|json)$/i, '');
}

/** booksCfg 书卡用文件名做 id；通用名 config_mdr / config 仍用所在目录名。 */
function extraBookPreferredId(configAbs) {
  const stem = stripConfigExt(path.basename(configAbs));
  if (!stem || /^(config_mdr|config)$/i.test(stem)) {
    return path.basename(path.dirname(configAbs));
  }
  return stem;
}

function tryLoadExtraBook(configAbs) {
  let raw;
  try {
    raw = parseJsonc(fs.readFileSync(configAbs, 'utf8'));
  } catch {
    return null;
  }
  if (!isBookConfigShape(raw)) return null;
  try {
    return parseBookConfig(configAbs, extraBookPreferredId(configAbs));
  } catch {
    return null;
  }
}

function uniqueBookId(next, preferred, contextDir) {
  if (!next.has(preferred)) return preferred;
  const suffix = path.basename(contextDir || preferred);
  let id = suffix + '__' + preferred;
  let n = 2;
  while (next.has(id)) {
    id = suffix + '__' + preferred + '_' + n;
    n += 1;
  }
  return id;
}

function registerDiscoveredBook(next, seenCfg, book, contextDir) {
  const cfgKey = book.configAbs || dirKey(path.join(book.configDir, 'config_mdr.jsonc'));
  if (seenCfg.has(cfgKey)) return;
  seenCfg.add(cfgKey);
  let id = book.id;
  if (next.has(id)) {
    const nextId = uniqueBookId(next, id, contextDir);
    console.warn('[book] 书名 id 冲突，将 ' + book.configDir + ' 记为 ' + nextId);
    id = nextId;
    book.id = id;
  }
  const prev = books.get(id);
  if (prev && rootsKey(prev.contentRoots) === rootsKey(book.contentRoots) && prev.watchers && prev.watchers.length) {
    book.watchers = prev.watchers;
    book.watchTimer = prev.watchTimer;
    prev.watchers = [];
  } else {
    startWatch(book);
  }
  next.set(id, book);
}

function stopWatch(book) {
  if (book.watchTimer) {
    clearTimeout(book.watchTimer);
    book.watchTimer = null;
  }
  for (const watcher of book.watchers || []) {
    try { watcher.close(); } catch (_) { /* ignore */ }
  }
  book.watchers = [];
}

function startWatch(book) {
  stopWatch(book);
  const invalidate = () => {
    book.treeCache = null;
    refreshHomeReadme(book);
    for (const root of book.contentRoots) clearH1Under(root);
  };
  for (const root of book.contentRoots) {
    try {
      const watcher = fs.watch(root, { recursive: true }, () => {
        if (book.watchTimer) clearTimeout(book.watchTimer);
        book.watchTimer = setTimeout(invalidate, 150);
      });
      watcher.on('error', () => {});
      book.watchers.push(watcher);
    } catch (err) {
      console.warn('[watch] ' + book.id + ' @ ' + root + ': ' + err.message);
    }
  }
}

function discoverBooks() {
  loadReaderConfig();
  const next = new Map();
  const seenCfg = new Set();
  if (!booksRoots.length && !extraBookConfigs.length) {
    for (const old of books.values()) stopWatch(old);
    books = next;
    return;
  }

  for (const booksRoot of booksRoots) {
    let names;
    try {
      names = fs.readdirSync(booksRoot);
    } catch (err) {
      console.warn('[config] 无法读取 booksRoot ' + booksRoot + '：' + err.message);
      continue;
    }
    names.sort(naturalCompare);
    for (const name of names) {
      if (isAlwaysIgnoredName(name)) continue;
      const dirAbs = path.join(booksRoot, name);
      let stat;
      try { stat = fs.statSync(dirAbs); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const cfgAbs = firstExistingFile(dirAbs, ['config_mdr.jsonc', 'config_mdr.json']);
      if (!cfgAbs) continue;
      try {
        registerDiscoveredBook(next, seenCfg, parseBookConfig(cfgAbs, name), booksRoot);
      } catch (err) {
        console.warn('[book] 跳过 ' + name + '：' + err.message);
      }
    }
  }

  for (const cfgAbs of extraBookConfigs) {
    const book = tryLoadExtraBook(cfgAbs);
    if (!book) {
      console.warn('[book] 忽略不符合格式的书籍配置：' + cfgAbs);
      continue;
    }
    registerDiscoveredBook(next, seenCfg, book, path.dirname(cfgAbs));
  }

  for (const [id, old] of books) {
    if (!next.has(id)) stopWatch(old);
  }
  books = next;
}

function statSig(abs) {
  try {
    const st = fs.statSync(abs);
    return abs + ':' + st.mtimeMs + ':' + st.size;
  } catch {
    return abs + ':missing';
  }
}

function isWatchedConfigName(name) {
  if (!name) return false;
  const n = String(name);
  return /\.jsonc$/i.test(n) || /^(config|config_mdr)\.json$/i.test(n);
}

function configSnapshot() {
  const parts = [];
  const main = firstExistingFile(ROOT, ['config.jsonc', 'config.json']);
  parts.push(statSig(main || path.join(ROOT, 'config.jsonc')));
  for (const dir of booksRoots) {
    parts.push(statSig(dir));
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    names.sort(naturalCompare);
    for (const name of names) {
      if (isAlwaysIgnoredName(name)) continue;
      const child = path.join(dir, name);
      parts.push(statSig(child));
      const cfg = firstExistingFile(child, ['config_mdr.jsonc', 'config_mdr.json', 'config.jsonc', 'config.json']);
      if (cfg) parts.push(statSig(cfg));
    }
  }
  for (const fileAbs of extraBookConfigs) parts.push(statSig(fileAbs));
  for (const dir of booksCfgWatchDirs) parts.push(statSig(dir));
  for (const fileAbs of relayConfigFiles) parts.push(statSig(fileAbs));
  for (const book of books.values()) {
    if (book.configAbs) parts.push(statSig(book.configAbs));
  }
  return parts.join('\n');
}

function markConfigDirty() {
  if (Date.now() < ignoreWatchUntil) return;
  configDirty = true;
  if (configWatchTimer) clearTimeout(configWatchTimer);
  configWatchTimer = setTimeout(() => {
    try {
      ensureFreshBooks();
    } catch (err) {
      console.warn('[config] 热更新失败：' + err.message);
    }
  }, 200);
}

function stopConfigWatchers() {
  for (const watcher of configWatchers) {
    try { watcher.close(); } catch (_) { /* ignore */ }
  }
  configWatchers = [];
}

function syncConfigWatchers() {
  ignoreWatchUntil = Date.now() + 400;
  stopConfigWatchers();
  const dirs = new Set();
  dirs.add(ROOT);
  for (const dir of booksRoots) dirs.add(dir);
  for (const dir of booksCfgWatchDirs) dirs.add(dir);
  for (const fileAbs of extraBookConfigs) dirs.add(path.dirname(fileAbs));
  for (const fileAbs of relayConfigFiles) dirs.add(path.dirname(fileAbs));
  for (const book of books.values()) {
    if (book.configAbs) dirs.add(path.dirname(book.configAbs));
    if (book.configDir) dirs.add(book.configDir);
  }
  for (const dir of dirs) {
    try {
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename && isAlwaysIgnoredName(String(filename))) return;
        const inRoot = booksRoots.some((root) => dir === root);
        if (filename && !isWatchedConfigName(filename) && !inRoot && dir !== ROOT) return;
        if (dir === ROOT && filename && !isWatchedConfigName(filename)) return;
        markConfigDirty();
      });
      watcher.on('error', () => {});
      configWatchers.push(watcher);
    } catch (err) {
      console.warn('[watch] 配置目录 ' + dir + '：' + err.message);
    }
  }
}

function ensureFreshBooks() {
  if (configDiscovering) return;
  const snap = configSnapshot();
  if (!configDirty && configFingerprint && snap === configFingerprint) return;
  configDiscovering = true;
  try {
    discoverBooks();
    const nextSnap = configSnapshot();
    if (nextSnap !== configFingerprint) {
      const first = !configFingerprint;
      configFingerprint = nextSnap;
      configRevision += 1;
      if (!first) {
        console.log('[config] 已热更新，当前 ' + books.size + ' 本书');
      }
    } else {
      configFingerprint = nextSnap;
    }
    configDirty = false;
    syncConfigWatchers();
  } finally {
    configDiscovering = false;
  }
}

function getBook(id) {
  if (!id) return null;
  ensureFreshBooks();
  return books.get(id) || null;
}

function bookPublic(book) {
  return {
    id: book.id,
    name: book.name,
    coverUrl: book.hasCover ? '/api/books/' + encodeURIComponent(book.id) + '/cover' : null,
    meta: book.meta,
    features: book.features,
    hasHomeReadme: book.hasHomeReadme
  };
}

function buildTree(book, absPath, relativePath) {
  const relPosix = toPosix(relativePath);
  if (relPosix && isExcluded(relPosix, book.exclude)) return null;

  let stat;
  try { stat = fs.statSync(absPath); } catch { return null; }

  if (stat.isFile()) {
    if (!/\.md$/i.test(path.basename(absPath))) return null;
    if (isReadmeName(path.basename(absPath))) return null;
    const fileName = stripMdExt(path.basename(absPath));
    const docPath = stripMdExt(relPosix);
    const h1 = book.features.UseTitleAsFileName ? getH1(absPath) : null;
    return {
      type: 'file',
      name: fileName,
      path: docPath,
      title: h1 || fileName,
      subtitle: book.features.UseTitleAsFileName ? fileName : null
    };
  }

  if (!stat.isDirectory()) return null;

  const dirName = path.basename(absPath);
  let entries;
  try {
    entries = fs.readdirSync(absPath).sort(naturalCompare);
  } catch {
    return null;
  }

  const children = [];
  for (const entry of entries) {
    if (isAlwaysIgnoredName(entry)) continue;
    const entryAbs = path.join(absPath, entry);
    const entryRel = relPosix ? relPosix + '/' + entry : entry;
    if (isExcluded(toPosix(entryRel), book.exclude)) continue;
    let entryStat;
    try { entryStat = fs.statSync(entryAbs); } catch { continue; }
    if (entryStat.isDirectory()) {
      const subtree = buildTree(book, entryAbs, entryRel);
      if (subtree) children.push(subtree);
    } else if (entryStat.isFile() && /\.md$/i.test(entry) && !isReadmeName(entry)) {
      const node = buildTree(book, entryAbs, entryRel);
      if (node) children.push(node);
    }
  }

  const readmeAbs = findReadmeFile(absPath);
  const isRoot = book.contentRoots.some((root) => path.resolve(root) === path.resolve(absPath));
  if (isRoot) {
    return { type: 'directory', name: dirName, path: relPosix, children, hasReadme: !!readmeAbs };
  }

  if (children.length === 0 && !readmeAbs) return null;

  const readmeH1 = book.features.UseTitleAsSectionName && readmeAbs ? getH1(readmeAbs) : null;
  return {
    type: 'directory',
    name: dirName,
    path: relPosix,
    title: readmeH1 || dirName,
    subtitle: book.features.UseTitleAsSectionName ? dirName : null,
    hasReadme: !!readmeAbs,
    readmePath: readmeAbs ? (relPosix ? relPosix + '/README' : 'README') : null,
    children
  };
}

function mergeTreeLists(lists) {
  const map = new Map();
  const order = [];
  for (const list of lists) {
    for (const node of list || []) {
      const key = node.type + '\0' + (node.path || node.name);
      if (!map.has(key)) {
        map.set(key, node);
        order.push(key);
        continue;
      }
      if (node.type === 'directory' && map.get(key).type === 'directory') {
        const existing = map.get(key);
        existing.children = mergeTreeLists([existing.children || [], node.children || []]);
        if (!existing.hasReadme && node.hasReadme) {
          existing.hasReadme = true;
          existing.readmePath = node.readmePath;
          existing.title = node.title || existing.title;
        }
      }
    }
  }
  const merged = order.map((k) => map.get(k));
  merged.sort((a, b) => naturalCompare(a.name, b.name));
  return merged;
}

function getBookTree(book) {
  if (book.treeCache) return book.treeCache;
  const trees = book.contentRoots.map((root) => {
    const node = buildTree(book, root, '');
    return node && node.children ? node.children : [];
  });
  refreshHomeReadme(book);
  book.treeCache = mergeTreeLists(trees);
  return book.treeCache;
}

function resolveDocInRoot(book, root, normalized) {
  const absNoExt = path.resolve(root, normalized);
  if (!isInside(root, absNoExt)) return null;

  const last = path.basename(normalized);
  const dir = path.dirname(absNoExt);

  if (last.toLowerCase() === 'readme' || last === '__home' || last === '#') {
    const targetDir = (last === '__home' || last === '#') ? root : dir;
    const found = findReadmeFile(targetDir);
    if (found && isInside(root, found) && !isExcluded(toPosix(path.relative(root, found)), book.exclude)) {
      return found;
    }
    return null;
  }

  const relForExclude = toPosix(path.relative(root, absNoExt + '.md'));
  if (isExcluded(relForExclude, book.exclude) || isExcluded(normalized + '.md', book.exclude)) {
    return null;
  }

  const exact = absNoExt + '.md';
  if (fs.existsSync(exact) && fs.statSync(exact).isFile() && isInside(root, exact)) {
    return exact;
  }

  if (fs.existsSync(dir)) {
    const want = last.toLowerCase() + '.md';
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }
    const found = entries.find((e) => e.toLowerCase() === want);
    if (found) {
      const abs = path.join(dir, found);
      if (fs.statSync(abs).isFile() && isInside(root, abs)) return abs;
    }
  }
  return null;
}

function resolveDocFile(book, relPath) {
  if (!relPath || relPath === '__home' || relPath === '#' || relPath === '/') {
    return book.homeReadmeAbs || null;
  }
  const normalized = toPosix(relPath).replace(/\.md$/i, '').replace(/^\/+/, '');
  if (!normalized || normalized === '#' || normalized === '__home') {
    return book.homeReadmeAbs || null;
  }

  for (const root of book.contentRoots) {
    const found = resolveDocInRoot(book, root, normalized);
    if (found) return found;
  }
  return null;
}

function collectMdFiles(book, absDir, relDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir).sort(naturalCompare);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (isAlwaysIgnoredName(entry)) continue;
    const entryAbs = path.join(absDir, entry);
    const entryRel = relDir ? relDir + '/' + entry : entry;
    if (isExcluded(toPosix(entryRel), book.exclude)) continue;
    let stat;
    try { stat = fs.statSync(entryAbs); } catch { continue; }
    if (stat.isDirectory()) {
      collectMdFiles(book, entryAbs, entryRel, out);
    } else if (stat.isFile() && /\.md$/i.test(entry)) {
      out.push({ absPath: entryAbs, relPath: toPosix(entryRel) });
    }
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(findAvailablePort(startPort + 1)));
    server.once('listening', () => server.close(() => resolve(startPort)));
    server.listen(startPort);
  });
}

function openBrowser(url) {
  switch (process.platform) {
    case 'darwin': exec(`open "${url}"`); break;
    case 'win32': exec(`start "" "${url}"`); break;
    default: exec(`xdg-open "${url}"`); break;
  }
}

app.use('/Src', express.static(path.join(ROOT, 'Src')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.get('/api/status', (req, res) => {
  ensureFreshBooks();
  res.json({
    ok: !booksRootError,
    error: booksRootError,
    booksRoot: booksRoots,
    booksCfg: extraBookConfigs,
    bookCount: books.size,
    revision: configRevision
  });
});

app.get('/api/books', (req, res) => {
  ensureFreshBooks();
  if (booksRootError) {
    return res.status(500).json({ error: booksRootError, books: [] });
  }
  const list = Array.from(books.values()).map(bookPublic);
  res.json(list);
});

app.get('/api/books/:id/cover', (req, res) => {
  const book = getBook(req.params.id);
  if (!book || !book.coverAbs) return res.status(404).end();
  res.sendFile(book.coverAbs);
});

app.get('/api/books/:id/tree', (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到书籍' });
  const tree = getBookTree(book);
  res.json({
    hasHomeReadme: book.hasHomeReadme,
    features: book.features,
    tree
  });
});

app.get('/api/books/:id/search', (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).json([]);
  const query = String(req.query.q || '').trim();
  if (!query) return res.json([]);

  const lowerQuery = query.toLowerCase();
  const results = [];
  const files = [];
  const seenRel = new Set();
  for (const root of book.contentRoots) {
    const batch = [];
    collectMdFiles(book, root, '', batch);
    for (const item of batch) {
      if (seenRel.has(item.relPath)) continue;
      seenRel.add(item.relPath);
      files.push(item);
    }
  }

  for (const { absPath, relPath } of files) {
    let content;
    try { content = fs.readFileSync(absPath, 'utf8'); } catch { continue; }
    const fileName = stripMdExt(path.basename(relPath));
    const dirPath = toPosix(path.dirname(relPath));
    const h1 = extractH1FromContent(content) || fileName;
    const title = book.features.UseTitleAsFileName ? h1 : fileName;

    const nameMatch =
      fileName.toLowerCase().includes(lowerQuery) ||
      title.toLowerCase().includes(lowerQuery) ||
      (dirPath && dirPath.toLowerCase().includes(lowerQuery));

    const contentMatches = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('```')) continue;
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        contentMatches.push({ line: i + 1, text: lines[i].trim().substring(0, 200) });
        if (contentMatches.length >= 5) break;
      }
    }

    if (nameMatch || contentMatches.length > 0) {
      let score = 0;
      if (fileName.toLowerCase().includes(lowerQuery)) score += 10;
      if (title.toLowerCase().includes(lowerQuery)) score += 8;
      if (dirPath && dirPath.toLowerCase().includes(lowerQuery)) score += 3;
      score += Math.min(contentMatches.length, 5);
      results.push({
        path: stripMdExt(relPath),
        dirPath: dirPath === '.' ? '' : dirPath,
        fileName,
        title,
        score,
        matches: contentMatches
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  res.json(results.slice(0, 50));
});

app.get('/api/books/:id/doc/*', (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).type('text/plain').send('未找到书籍');
  const docPath = req.params[0] || '';
  const filePath = resolveDocFile(book, docPath);
  if (!filePath) {
    return res.status(404).type('text/plain').send('Document not found');
  }
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/api/books/:id', (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).json({ error: '未找到书籍' });
  refreshHomeReadme(book);
  res.json(bookPublic(book));
});

app.get('/content/:id/*', (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).end();
  const rel = req.params[0] || '';
  let insideAny = false;
  for (const root of book.contentRoots) {
    const abs = path.resolve(root, rel);
    if (!isInside(root, abs)) continue;
    insideAny = true;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return res.sendFile(abs);
    }
  }
  if (!insideAny) return res.status(403).end();
  return res.status(404).end();
});

ensureFreshBooks();

(async () => {
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const requestedPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
  const port = await findAvailablePort(requestedPort);

  app.listen(port, () => {
    console.log('Markdown 阅读器 running at http://localhost:' + port);
    if (booksRootError) {
      console.warn('[config] ' + booksRootError);
    } else {
      if (booksRoots.length) console.log('书籍根目录: ' + booksRoots.join(' | '));
      if (extraBookConfigs.length) console.log('补充书籍配置: ' + extraBookConfigs.length + ' 个');
      console.log('已发现 ' + books.size + ' 本书');
    }
    if (process.argv.includes('--open')) {
      openBrowser('http://localhost:' + port);
    }
  });
})();
