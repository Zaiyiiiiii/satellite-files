'use strict';
(() => {
// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'ic') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls);
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const store = {
  get(k, d) { try { return localStorage.getItem('files.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('files.' + k, v); } catch {} },
};

// ---------------------------------------------------------------- i18n
// Chinese is the default; English is available from the language button.
const STRINGS = {
  zh: {
    requestFailed: '请求失败', save: '保存', cancel: '取消',
    today: s => `今天 ${s}`, yesterday: s => `昨天 ${s}`,
    authTitle: '登录后继续', authText: '这个文件夹是私有的，登录后才能查看其中的内容。', signIn: '登录',
    deniedTitle: '无权访问', deniedText: '你的账号没有打开这个文件夹的权限。',
    missingTitle: '找不到文件夹', missingText: '它可能已被移动或删除。', goHome: '返回首页',
    errorTitle: '出错了', retry: '重试',
    inboxTitle: '只能上传的文件夹', inboxText: '你可以往这里上传文件，但看不到其中的内容。', chooseFiles: '选择文件',
    uploadFiles: '上传文件', uploadFolder: '上传文件夹', newFolder: '新建文件夹',
    emptyTitle: '这个文件夹是空的', emptyWrite: '把文件拖到页面上的任意位置，或者使用下面的按钮。', emptyRead: '这里还没有内容。',
    summary: (dirs, files, size) => [dirs && `${dirs} 个文件夹`, files && `${files} 个文件`, files && size].filter(Boolean).join(' · '),
    selected: n => `已选择 ${n} 项`, selectAll: '全选', selectItem: n => `选择 ${n}`, actions: '操作',
    colName: '名称', colSize: '大小', colModified: '修改时间',
    searching: q => `正在搜索“${q}”…`, results: (n, more, q) => `找到 ${n}${more ? '+' : ''} 个与“${q}”匹配的结果`,
    noMatches: '没有匹配的结果', noMatchesText: '换个名字试试，或者到上一级文件夹里搜索。',
    loading: '加载中…', loadFailed: '无法加载这个文件。', truncated: '\n\n…（文件较大，只显示了开头部分，下载后可以查看完整内容）',
    nth: (i, n) => `${i} / ${n}`, track: (i, n) => `第 ${i} / ${n} 首`,
    open: '打开', download: '下载', downloadTar: '下载为 .tar', openNewTab: '在新标签页中打开', rename: '重命名', moveTo: '移动到…', del: '删除',
    folderName: '文件夹名称', create: '创建', created: n => `已创建“${n}”`, renamed: '已重命名',
    moved: (n, dest) => `已将 ${n} 项移动到“${dest}”`, moveTitle: (names) => names.length === 1 ? `移动“${names[0]}”` : `移动 ${names.length} 项`,
    up: '上一级', noSubfolders: '没有子文件夹', moveHere: '移动到这里',
    what: (items) => items.length === 1 ? `“${items[0].name}”` : `${items.length} 项`,
    deleteTitle: what => `删除${what}？`, deleteDirText: '文件夹会连同其中的所有内容一起删除，此操作无法撤销。', deleteText: '此操作无法撤销。',
    deleted: what => `已删除${what}`, deletedN: n => `已删除 ${n} 项`,
    downloadFolder: '下载文件夹（.tar）', refresh: '刷新',
    waiting: size => `等待中 · ${size}`, progress: (a, b, speed) => `${a} / ${b} · ${speed}/s`, doneSize: size => `${size} · 已完成`,
    uploadFailed: '上传失败', exists: '已存在', skipped: '已跳过', networkError: '网络错误', cancelled: '已取消',
    uploading: (n, pct) => `正在上传 ${n} 个文件 · ${pct}%`, uploadedFailed: (d, f) => `已上传 ${d} 个，失败 ${f} 个`, uploaded: d => `已上传 ${d} 个文件`,
    conflictTitle: '文件已存在', conflictText: n => `这个文件夹里已经有“${n}”了，要怎么处理？`, applyAll: '剩下的冲突都这样处理',
    skip: '跳过', keepBoth: '保留两者', replace: '替换',
    account: '账号', signOut: '退出登录', userName: '用户名', password: '密码', signInTo: title => `登录到 ${title}`, welcome: u => `欢迎，${u}`,
    dropTo: name => `上传到“${name}”`,
    // static labels in index.html
    searchPlaceholder: '搜索当前文件夹', toggleTheme: '切换主题', language: 'Switch to English', breadcrumb: '路径',
    upload: '上传', more: '更多', view: '视图', listView: '列表视图', gridView: '网格视图', clearSelection: '取消选择', move: '移动',
    dropToUpload: '松开即可上传', collapse: '收起', close: '关闭', previous: '上一个', next: '下一个', playPause: '播放/暂停',
    closePlayer: '关闭播放器', closeEsc: '关闭（Esc）',
  },
  en: {
    requestFailed: 'Request failed', save: 'Save', cancel: 'Cancel',
    today: s => `Today, ${s}`, yesterday: s => `Yesterday, ${s}`,
    authTitle: 'Sign in to continue', authText: 'This folder is private. Sign in with your account to see what’s inside.', signIn: 'Sign in',
    deniedTitle: 'No access', deniedText: 'Your account doesn’t have permission to open this folder.',
    missingTitle: 'Folder not found', missingText: 'It may have been moved or deleted.', goHome: 'Go home',
    errorTitle: 'Something went wrong', retry: 'Try again',
    inboxTitle: 'Upload-only folder', inboxText: 'You can drop files here, but the contents are private.', chooseFiles: 'Choose files',
    uploadFiles: 'Upload files', uploadFolder: 'Upload a folder', newFolder: 'New folder',
    emptyTitle: 'This folder is empty', emptyWrite: 'Drag and drop files anywhere on this page, or use the buttons below.', emptyRead: 'Nothing to see here yet.',
    summary: (dirs, files, size) => [dirs && `${dirs} folder${dirs > 1 ? 's' : ''}`, files && `${files} file${files > 1 ? 's' : ''}`, files && size].filter(Boolean).join(' · '),
    selected: n => `${n} selected`, selectAll: 'Select all', selectItem: n => `Select ${n}`, actions: 'Actions',
    colName: 'Name', colSize: 'Size', colModified: 'Modified',
    searching: q => `Searching for “${q}”…`, results: (n, more, q) => `${n}${more ? '+' : ''} result${n === 1 ? '' : 's'} for “${q}”`,
    noMatches: 'No matches', noMatchesText: 'Try a different name, or search from a higher folder.',
    loading: 'Loading…', loadFailed: 'Could not load this file.', truncated: '\n\n… (file truncated, download to see everything)',
    nth: (i, n) => `${i} of ${n}`, track: (i, n) => `${i} of ${n}`,
    open: 'Open', download: 'Download', downloadTar: 'Download as .tar', openNewTab: 'Open in new tab', rename: 'Rename', moveTo: 'Move to…', del: 'Delete',
    folderName: 'Folder name', create: 'Create', created: n => `Created “${n}”`, renamed: 'Renamed',
    moved: (n, dest) => `Moved ${n} item${n > 1 ? 's' : ''} to ${dest}`, moveTitle: (names) => `Move ${names.length === 1 ? '“' + names[0] + '”' : names.length + ' items'}`,
    up: 'Up', noSubfolders: 'No subfolders', moveHere: 'Move here',
    what: (items) => items.length === 1 ? `“${items[0].name}”` : `${items.length} items`,
    deleteTitle: what => `Delete ${what}?`, deleteDirText: 'Folders are deleted with everything inside them. This can’t be undone.', deleteText: 'This can’t be undone.',
    deleted: what => `Deleted ${what}`, deletedN: n => `Deleted ${n} items`,
    downloadFolder: 'Download folder (.tar)', refresh: 'Refresh',
    waiting: size => `Waiting · ${size}`, progress: (a, b, speed) => `${a} of ${b} · ${speed}/s`, doneSize: size => `${size} · Done`,
    uploadFailed: 'Upload failed', exists: 'Already exists', skipped: 'Skipped', networkError: 'Network error', cancelled: 'Cancelled',
    uploading: (n, pct) => `Uploading ${n} file${n > 1 ? 's' : ''} · ${pct}%`, uploadedFailed: (d, f) => `${d} uploaded, ${f} failed`, uploaded: d => `${d} upload${d === 1 ? '' : 's'} complete`,
    conflictTitle: 'File already exists', conflictText: n => `“${n}” is already in this folder. What would you like to do?`, applyAll: 'Do this for the remaining conflicts',
    skip: 'Skip', keepBoth: 'Keep both', replace: 'Replace',
    account: 'Account', signOut: 'Sign out', userName: 'User name', password: 'Password', signInTo: title => `Sign in to ${title}`, welcome: u => `Welcome, ${u}`,
    dropTo: name => `into ${name}`,
    searchPlaceholder: 'Search this folder', toggleTheme: 'Toggle theme', language: '切换到中文', breadcrumb: 'Breadcrumb',
    upload: 'Upload', more: 'More', view: 'View', listView: 'List view', gridView: 'Grid view', clearSelection: 'Clear selection', move: 'Move',
    dropToUpload: 'Drop to upload', collapse: 'Collapse', close: 'Close', previous: 'Previous', next: 'Next', playPause: 'Play/Pause',
    closePlayer: 'Close player', closeEsc: 'Close (Esc)',
  },
};
// Server error messages (English in the API) shown in the Chinese UI.
const SERVER_ZH = {
  'Bad request': '请求无效', 'Sign in required': '需要登录', 'Permission denied': '没有权限', 'Not found': '找不到',
  'Method not allowed': '不支持这个操作', 'Already exists or conflicts with an existing item': '已存在同名项目',
  'Upload too large': '文件超过了上传大小限制', 'Range not satisfiable': '请求的范围无效',
  'Operation not supported across volumes': '不支持跨卷操作', 'Not enough storage space': '存储空间不足', 'Internal error': '服务器内部错误',
  'Missing X-Requested-With header': '缺少 X-Requested-With 请求头', 'Wrong user name or password': '用户名或密码错误',
  'A file with this name already exists': '已存在同名文件', 'Replacing files requires delete permission': '替换文件需要删除权限',
  'Something with this name already exists': '已存在同名项目', 'Something with this name already exists at the destination': '目标位置已存在同名项目',
  'A folder can’t be moved into itself': '不能把文件夹移动到它自己里面', "A folder can't be moved into itself": '不能把文件夹移动到它自己里面',
};
let LANG = store.get('lang', 'zh');
if (!STRINGS[LANG]) LANG = 'zh';
function t(key, ...args) {
  const v = STRINGS[LANG][key] ?? STRINGS.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
const serverMsg = m => (LANG === 'zh' && SERVER_ZH[m]) || m;
function applyStatic() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of $$('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of $$('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  $('#lang-btn').textContent = LANG === 'zh' ? 'EN' : '中';
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
}
let dfDay, dfTime;
function setFormatters() {
  const loc = LANG === 'zh' ? 'zh-CN' : 'en';
  dfDay = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', year: 'numeric' });
  dfTime = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
}
setFormatters();
function fmtDate(sec) {
  if (!sec) return '—';
  const d = new Date(sec * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return t('today', dfTime.format(d));
  if (days === 1) return t('yesterday', dfTime.format(d));
  return dfDay.format(d);
}
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  s = Math.floor(s);
  const m = Math.floor(s / 60), sec = String(s % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const KINDS = {
  image: 'jpg jpeg jfif png gif webp avif bmp ico',
  video: 'mp4 m4v webm mov ogv mkv',
  audio: 'mp3 m4a aac ogg oga opus flac wav',
  pdf: 'pdf',
  archive: 'zip tar gz tgz 7z rar xz bz2 zst iso dmg',
  code: 'js mjs ts tsx jsx json html htm css scss rs py go c h cpp hpp java kt rb php sh bat ps1 sql xml svg yaml yml toml ini conf cfg lua swift zig wit vue svelte diff patch',
  text: 'txt md markdown log csv tsv srt vtt nfo',
};
const EXT2KIND = {};
for (const [k, v] of Object.entries(KINDS)) for (const e of v.split(' ')) EXT2KIND[e] = k;
const ext = n => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
const kindOf = e => (e.dir ? 'folder' : EXT2KIND[ext(e.name)] || 'file');
const KIND_ICON = { folder: 'folder', image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', archive: 'archive', code: 'code', text: 'text', file: 'file' };
const fileIcon = kind => h('span', { class: 'fi ' + kind }, icon(KIND_ICON[kind]));
const previewable = k => ['image', 'video', 'code', 'text', 'pdf'].includes(k);

// ---------------------------------------------------------------- state
const S = {
  me: { user: null, accounts: false, title: document.title },
  path: '/',
  entries: [],
  perms: {},
  status: 'loading', // loading | ok | auth | denied | missing | error
  error: '',
  sort: { key: store.get('sortKey', 'name'), dir: +store.get('sortDir', 1) },
  view: store.get('view', 'list'),
  sel: new Set(),
  anchor: null,
  search: null, // { q, results, truncated, loading }
};

async function api(url, opts = {}) {
  opts.headers = { 'X-Requested-With': 'files', ...(opts.headers || {}) };
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error((data && data.error && serverMsg(data.error)) || r.statusText || t('requestFailed'));
    e.status = r.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------- toasts
function toast(msg, type = 'ok') {
  const el = h('div', { class: 'toast' + (type === 'err' ? ' err' : '') }, icon(type === 'err' ? 'x' : 'check'), msg);
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = 0; setTimeout(() => el.remove(), 260); }, type === 'err' ? 4200 : 2600);
}

// ---------------------------------------------------------------- dialogs
let dialogOpen = 0;
function dialog({ title, text, body, actions, wide, init }) {
  return new Promise(resolve => {
    dialogOpen++;
    const close = v => { dialogOpen--; bd.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const form = h('form', { class: 'dialog' + (wide ? ' wide' : ''), onsubmit: e => { e.preventDefault(); const a = actions.find(a => a.submit); if (a) close(a.value()); } });
    form.append(h('h2', { text: title }));
    if (text) form.append(h('p', { text }));
    if (body) form.append(body);
    const row = h('div', { class: 'actions' });
    for (const a of actions) {
      row.append(h('button', {
        type: a.submit ? 'submit' : 'button',
        class: 'btn ' + (a.cls || ''),
        onclick: a.submit ? null : () => close(typeof a.value === 'function' ? a.value() : a.value),
      }, a.label));
    }
    form.append(row);
    const bd = h('div', { class: 'backdrop', onmousedown: e => { if (e.target === bd) close(null); } }, form);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    document.body.append(bd);
    form.closeWith = close;
    (init && init(form)) || (form.querySelector('input') || form.querySelector('.btn:last-child'))?.focus();
  });
}
function askText(title, value = '', { ok = t('save'), label, selectStem } = {}) {
  const input = h('input', { class: 'input', value, spellcheck: 'false', autocomplete: 'off' });
  return dialog({
    title,
    body: h('label', { class: 'field' }, label ? h('span', { text: label }) : null, input),
    actions: [{ label: t('cancel'), value: null }, { label: ok, cls: 'primary', submit: true, value: () => input.value.trim() || null }],
    init: () => {
      input.focus();
      const dot = value.lastIndexOf('.');
      if (selectStem && dot > 0) input.setSelectionRange(0, dot); else input.select();
      return true;
    },
  });
}
function confirmBox(title, text, ok = t('del'), danger = true) {
  return dialog({ title, text, actions: [{ label: t('cancel'), value: false }, { label: ok, cls: danger ? 'danger solid' : 'primary', submit: true, value: () => true }] });
}

// ---------------------------------------------------------------- context menu
function openMenu(x, y, items) {
  const m = $('#menu');
  m.replaceChildren(...items.filter(Boolean).map(it => it === '-' ? h('hr') :
    h('button', { class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.run(); } }, icon(it.icon), it.label)));
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, y + r.height > innerHeight - 8 ? y - r.height : y) + 'px';
}
function closeMenu() { $('#menu').hidden = true; }
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) closeMenu(); });
addEventListener('blur', closeMenu);
addEventListener('scroll', closeMenu, true);

// ---------------------------------------------------------------- navigation
function currentPathFromUrl() {
  let p;
  try { p = decodeURIComponent(location.pathname); } catch { p = '/'; }
  return p.endsWith('/') ? p : p + '/';
}
const urlOf = (dir, name, isDir) => enc(dir + name) + (isDir ? '/' : '');

let loadSeq = 0;
async function load(path, { push = true, keepSel = false } = {}) {
  const seq = ++loadSeq;
  const changed = path !== S.path;
  S.path = path;
  if (push && changed) history.pushState(null, '', enc(path));
  if (changed || !keepSel) { S.sel.clear(); S.anchor = null; }
  if (changed) exitSearch(false);
  renderCrumbs();
  const slow = setTimeout(() => { if (seq === loadSeq) { S.status = 'loading'; render(); } }, 160);
  try {
    const d = await api(enc(path) + '?ls');
    if (seq !== loadSeq) return;
    S.entries = d.entries;
    S.perms = d.perms;
    S.status = 'ok';
    for (const n of [...S.sel]) if (!S.entries.some(e => e.name === n)) S.sel.delete(n);
  } catch (e) {
    if (seq !== loadSeq) return;
    S.entries = [];
    S.perms = {};
    S.status = e.status === 401 ? 'auth' : e.status === 403 ? 'denied' : e.status === 404 ? 'missing' : 'error';
    S.error = e.message;
  } finally {
    clearTimeout(slow);
  }
  render();
}
const refresh = () => load(S.path, { push: false, keepSel: true });
addEventListener('popstate', () => { closeViewer(); load(currentPathFromUrl(), { push: false }); });
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  load(a.dataset.nav);
});

// ---------------------------------------------------------------- rendering
function sorted(list) {
  const { key, dir } = S.sort;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...list].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let r = 0;
    if (key === 'size') r = (a.size || 0) - (b.size || 0);
    else if (key === 'mtime') r = (a.mtime || 0) - (b.mtime || 0);
    if (r === 0) r = coll.compare(a.name, b.name);
    return r * dir;
  });
}
const visible = () => (S.search ? S.search.results || [] : sorted(S.entries));

function renderCrumbs() {
  const c = $('#crumbs');
  const parts = S.path.split('/').filter(Boolean);
  const kids = [];
  let acc = '/';
  const home = h('a', { href: '/', dataset: { nav: '/' }, title: S.me.title }, icon('home'));
  if (!parts.length) kids.push(h('span', { class: 'cur' }, S.me.title));
  else kids.push(home);
  parts.forEach((p, i) => {
    acc += p + '/';
    kids.push(icon('right', 'ic sep'));
    kids.push(i === parts.length - 1 ? h('span', { class: 'cur', title: p }, p) : h('a', { href: enc(acc), dataset: { nav: acc, drop: acc }, title: p }, p));
  });
  if (parts.length) home.dataset.drop = '/';
  c.replaceChildren(...kids);
  document.title = parts.length ? `${parts[parts.length - 1]} · ${S.me.title}` : S.me.title;
}

function renderTools() {
  const p = S.perms;
  const ok = S.status === 'ok';
  $('#upload-btn').hidden = !(ok && p.write);
  $('#mkdir-btn').hidden = !(ok && p.write);
  $('#more-btn').parentElement.hidden = !ok;
  for (const b of $$('[data-view]')) b.classList.toggle('active', b.dataset.view === S.view);
  const n = S.sel.size;
  $('#selbar').hidden = n === 0;
  $('#sel-count').textContent = t('selected', n);
  const selItems = selectedEntries();
  $('#selbar [data-act=download]').hidden = !p.read;
  $('#selbar [data-act=rename]').hidden = !(p.move && n === 1);
  $('#selbar [data-act=move]').hidden = !(p.move && !S.search);
  $('#selbar [data-act=delete]').hidden = !(p.delete && !S.search) || !selItems.length;
}

function stateView(ic, title, text, buttons = []) {
  return h('div', { class: 'empty' }, h('div', { class: 'big' }, icon(ic)), h('h3', { text: title }), text ? h('p', { text }) : null, buttons.length ? h('div', { class: 'row-btns' }, buttons) : null);
}

function render() {
  renderTools();
  const v = $('#view');
  v.className = 'view';
  $('#summary').textContent = '';
  if (S.status === 'loading') {
    v.replaceChildren(...Array.from({ length: 6 }, (_, i) => h('div', { class: 'skeleton' }, h('i', { style: `width:${30 + ((i * 37) % 40)}%` }))));
    return;
  }
  if (S.status === 'auth') {
    v.replaceChildren(stateView('lock', t('authTitle'), t('authText'), [h('button', { class: 'btn primary', onclick: login }, icon('user'), t('signIn'))]));
    return;
  }
  if (S.status === 'denied') { v.replaceChildren(stateView('lock', t('deniedTitle'), t('deniedText'))); return; }
  if (S.status === 'missing') { v.replaceChildren(stateView('folder', t('missingTitle'), t('missingText'), [h('a', { class: 'btn', href: '/', dataset: { nav: '/' } }, icon('home'), t('goHome'))])); return; }
  if (S.status === 'error') { v.replaceChildren(stateView('x', t('errorTitle'), S.error, [h('button', { class: 'btn', onclick: refresh }, t('retry'))])); return; }

  if (S.search) return renderSearch(v);
  const list = sorted(S.entries);
  if (!S.perms.read && S.perms.write) {
    v.replaceChildren(stateView('inbox', t('inboxTitle'), t('inboxText'), [h('button', { class: 'btn primary', onclick: () => $('#file-input').click() }, icon('upload'), t('chooseFiles'))]));
    return;
  }
  if (!list.length) {
    const btns = S.perms.write ? [h('button', { class: 'btn primary', onclick: () => $('#file-input').click() }, icon('upload'), t('uploadFiles')), h('button', { class: 'btn', onclick: mkdir }, icon('folder-plus'), t('newFolder'))] : [];
    v.replaceChildren(stateView('folder', t('emptyTitle'), S.perms.write ? t('emptyWrite') : t('emptyRead'), btns));
    return;
  }
  v.replaceChildren(S.view === 'grid' ? gridView(list) : listView(list));
  const dirs = list.filter(e => e.dir).length, files = list.length - dirs;
  const bytes = list.reduce((s, e) => s + (e.dir ? 0 : e.size), 0);
  $('#summary').textContent = t('summary', dirs, files, fmtSize(bytes));
}

function sortHead(key, label, cls) {
  const on = S.sort.key === key;
  return h('div', { class: cls || '' }, h('button', {
    onclick: () => {
      S.sort = { key, dir: on ? -S.sort.dir : key === 'name' ? 1 : -1 };
      store.set('sortKey', S.sort.key); store.set('sortDir', S.sort.dir);
      render();
    },
  }, label, on ? icon(S.sort.dir > 0 ? 'up' : 'down') : null));
}

function listView(list) {
  const all = h('input', { type: 'checkbox', class: 'cb', title: t('selectAll'), onchange: e => { e.target.checked ? list.forEach(x => S.sel.add(x.name)) : S.sel.clear(); render(); } });
  all.checked = S.sel.size > 0 && S.sel.size === list.length;
  all.indeterminate = S.sel.size > 0 && S.sel.size < list.length;
  const wrap = h('div', { class: S.sel.size ? 'selecting' : '' },
    h('div', { class: 'thead' }, h('div', { class: 'check' }, all), sortHead('name', t('colName')), sortHead('size', t('colSize'), 'r'), sortHead('mtime', t('colModified')), h('div')));
  list.forEach((e, i) => wrap.append(row(e, i, list)));
  $('#view').classList.toggle('selecting', S.sel.size > 0);
  return wrap;
}

function row(e, i, list, pathLabel) {
  const kind = kindOf(e);
  const dir = e.path ? e.path.replace(/[^/]*\/?$/, '') : null;
  const href = e.path ? e.path : urlOf(S.path, e.name, e.dir);
  const sel = S.sel.has(e.name) && !pathLabel;
  const cb = pathLabel ? h('span') : h('input', { type: 'checkbox', class: 'cb', 'aria-label': t('selectItem', e.name), onclick: ev => { ev.stopPropagation(); toggleSel(e, list, ev); } });
  if (sel) cb.checked = true;
  const link = h('a', { href: e.dir ? href : href, draggable: 'false', onclick: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return; ev.preventDefault(); open(e, list); } }, e.name);
  const r = h('div', {
    class: 'row' + (sel ? ' sel' : ''),
    dataset: e.dir && !pathLabel ? { drop: S.path + e.name + '/' } : {},
    draggable: !pathLabel && S.perms.move ? 'true' : null,
    onclick: ev => { if (ev.target.closest('a,button,input')) return; pathLabel ? open(e, list) : toggleSel(e, list, ev); },
    ondblclick: ev => { if (!ev.target.closest('a,button,input')) open(e, list); },
    oncontextmenu: ev => { if (pathLabel) return; ev.preventDefault(); itemMenu(e, list, ev.clientX, ev.clientY); },
    ondragstart: ev => dragStart(ev, e),
  },
    h('div', { class: 'check' }, cb),
    h('div', { class: 'name' }, fileIcon(kind), h('div', { class: 'stack' }, link,
      pathLabel ? h('span', { class: 'path', text: dir }) : h('small', { text: e.dir ? fmtDate(e.mtime) : `${fmtSize(e.size)} · ${fmtDate(e.mtime)}` }))),
    h('div', { class: 'cell r', text: e.dir ? '—' : fmtSize(e.size) }),
    h('div', { class: 'cell', text: fmtDate(e.mtime) }),
    pathLabel ? h('div') : h('div', {}, h('button', { class: 'icon-btn more', title: t('actions'), onclick: ev => { ev.stopPropagation(); const b = ev.currentTarget.getBoundingClientRect(); itemMenu(e, list, b.right - 200, b.bottom + 4); } }, icon('more'))));
  return r;
}

function gridView(list) {
  const g = h('div', { class: 'grid' + (S.sel.size ? ' selecting' : '') });
  $('#view').classList.add('grid-mode');
  for (const e of list) {
    const kind = kindOf(e);
    const url = urlOf(S.path, e.name, e.dir);
    const thumb = h('div', { class: 'thumb' }, kind === 'image' ? h('img', { src: url, loading: 'lazy', alt: '', draggable: 'false', onerror: ev => ev.target.replaceWith(fileIcon(kind)) }) : fileIcon(kind));
    const cb = h('input', { type: 'checkbox', class: 'cb', onclick: ev => { ev.stopPropagation(); toggleSel(e, list, ev); } });
    cb.checked = S.sel.has(e.name);
    g.append(h('div', {
      class: 'card' + (S.sel.has(e.name) ? ' sel' : ''),
      dataset: e.dir ? { drop: S.path + e.name + '/' } : {},
      draggable: S.perms.move ? 'true' : null,
      title: e.name,
      onclick: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey || S.sel.size) toggleSel(e, list, ev); else open(e, list); },
      oncontextmenu: ev => { ev.preventDefault(); itemMenu(e, list, ev.clientX, ev.clientY); },
      ondragstart: ev => dragStart(ev, e),
    }, cb, thumb, h('div', { class: 'meta' }, h('b', { text: e.name }), h('span', { text: e.dir ? fmtDate(e.mtime) : `${fmtSize(e.size)} · ${fmtDate(e.mtime)}` }))));
  }
  return g;
}

function toggleSel(e, list, ev) {
  if (ev && ev.shiftKey && S.anchor != null) {
    const a = list.findIndex(x => x.name === S.anchor), b = list.findIndex(x => x.name === e.name);
    if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(list[i].name); render(); return; }
  }
  S.sel.has(e.name) ? S.sel.delete(e.name) : S.sel.add(e.name);
  S.anchor = e.name;
  render();
}
const selectedEntries = () => S.entries.filter(e => S.sel.has(e.name));

// ---------------------------------------------------------------- search
let searchTimer;
function exitSearch(rerender = true) {
  if (!S.search) return;
  S.search = null;
  $('#search').value = '';
  if (rerender) render();
}
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) return exitSearch();
  searchTimer = setTimeout(async () => {
    S.search = { q, results: S.search?.results || [], loading: true };
    S.sel.clear();
    render();
    try {
      const d = await api(enc(S.path) + '?find=' + encodeURIComponent(q));
      if (!S.search || S.search.q !== q) return;
      S.search = { q, results: d.results, truncated: d.truncated };
    } catch (err) {
      if (S.search) S.search = { q, results: [], error: err.message };
    }
    render();
  }, 220);
});
$('#search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); exitSearch(); e.target.blur(); } });

function renderSearch(v) {
  const { q, results, loading, truncated, error } = S.search;
  const head = h('div', { class: 'section-title' }, icon('search'),
    loading ? t('searching', q) : error ? error : t('results', results.length, truncated, q));
  if (!loading && !results.length) { v.replaceChildren(head, stateView('search', t('noMatches'), t('noMatchesText'))); return; }
  const wrap = h('div', {}, head);
  results.forEach((e, i) => wrap.append(row(e, i, results, true)));
  v.replaceChildren(wrap);
}

// ---------------------------------------------------------------- open & preview
function open(e, list) {
  const url = e.path || urlOf(S.path, e.name, e.dir);
  if (e.dir) { let p; try { p = decodeURIComponent(url); } catch { return; } return load(p); }
  const kind = kindOf(e);
  if (kind === 'audio') return playAudio(e, list);
  if (previewable(kind)) return openViewer(e, list);
  location.href = url + '?dl';
}

const V = { items: [], i: 0 };
async function openViewer(e, list) {
  V.items = list.filter(x => !x.dir && previewable(kindOf(x)));
  V.i = Math.max(0, V.items.indexOf(e));
  $('#viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  showViewerItem();
}
async function showViewerItem() {
  const e = V.items[V.i];
  if (!e) return closeViewer();
  const url = e.path || urlOf(S.path, e.name, false);
  const kind = kindOf(e);
  $('#v-name').textContent = e.name;
  $('#v-meta').textContent = `${fmtSize(e.size)} · ${fmtDate(e.mtime)}` + (V.items.length > 1 ? ` · ${t('nth', V.i + 1, V.items.length)}` : '');
  $('#v-dl').href = url + '?dl';
  $('#v-open').href = url;
  $('#v-prev').hidden = $('#v-next').hidden = V.items.length < 2;
  const body = $('#v-body');
  if (kind === 'image') body.replaceChildren(h('img', { src: url, alt: e.name }));
  else if (kind === 'video') body.replaceChildren(h('video', { src: url, controls: true, autoplay: true, playsinline: true }));
  else if (kind === 'pdf') body.replaceChildren(h('iframe', { src: url, title: e.name }));
  else {
    const doc = h('pre', { class: 'doc', text: t('loading') });
    body.replaceChildren(doc);
    try {
      const limit = 2 * 1024 * 1024;
      const r = await fetch(url, { headers: { Range: `bytes=0-${limit - 1}` } });
      let text = await r.text();
      if (V.items[V.i] !== e) return;
      if (e.size > limit) text += t('truncated');
      if (['md', 'markdown'].includes(ext(e.name))) {
        const div = h('div', { class: 'doc md' });
        div.innerHTML = markdown(text);
        body.replaceChildren(div);
      } else doc.textContent = text;
    } catch { doc.textContent = t('loadFailed'); }
  }
  const nx = V.items[V.i + 1];
  if (nx && kindOf(nx) === 'image') new Image().src = nx.path || urlOf(S.path, nx.name, false);
}
function closeViewer() {
  if ($('#viewer').hidden) return;
  $('#viewer').hidden = true;
  $('#v-body').replaceChildren();
  document.body.style.overflow = '';
}
const stepViewer = d => { if (V.items.length > 1) { V.i = (V.i + d + V.items.length) % V.items.length; showViewerItem(); } };
$('#v-close').onclick = closeViewer;
$('#v-prev').onclick = () => stepViewer(-1);
$('#v-next').onclick = () => stepViewer(1);
$('#v-body').addEventListener('click', e => { if (e.target.id === 'v-body') closeViewer(); });
let touchX = null;
$('#v-body').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('#v-body').addEventListener('touchend', e => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 60) stepViewer(dx < 0 ? 1 : -1); touchX = null; });

// Tiny, safe markdown renderer (escapes all HTML first).
function markdown(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => /^(https?:|\/|\.|[\w-]+\/)/.test(u) && !/^javascript:/i.test(u) ? `<img alt="${a}" src="${u}">` : m)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => /^(https?:|mailto:|\/|#|\.|[\w-]+)/.test(u) && !/^(javascript|data|vbscript):/i.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : m)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  const out = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para = [], list = null;
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if (/^```/.test(l)) {
      flushP(); flushL();
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
    } else if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flushP(); flushL(); out.push('<hr>'); }
    else if ((m = l.match(/^>\s?(.*)$/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); }
    else if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flushP();
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.t !== tag) { flushL(); list = { t: tag, items: [] }; }
      list.items.push(m[2]);
    } else if (!l.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(l.trim()); }
  }
  flushP(); flushL();
  return out.join('\n');
}

// ---------------------------------------------------------------- audio player
const audio = $('#audio');
const P = { items: [], i: 0, dir: '' };
function playAudio(e, list) {
  P.items = list.filter(x => kindOf(x) === 'audio');
  P.i = Math.max(0, P.items.indexOf(e));
  P.dir = S.path;
  playIndex(P.i);
}
function playIndex(i) {
  const e = P.items[i];
  if (!e) return;
  P.i = i;
  audio.src = e.path || urlOf(P.dir, e.name, false);
  audio.play().catch(() => {});
  $('#player').hidden = false;
  const title = e.name.replace(/\.[^.]+$/, '');
  $('#pl-title').textContent = title;
  $('#pl-sub').textContent = `${P.dir.split('/').filter(Boolean).pop() || S.me.title} · ${t('track', i + 1, P.items.length)}`;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title, album: P.dir.split('/').filter(Boolean).pop() || '' });
    navigator.mediaSession.setActionHandler('previoustrack', () => playIndex((P.i - 1 + P.items.length) % P.items.length));
    navigator.mediaSession.setActionHandler('nexttrack', () => playIndex((P.i + 1) % P.items.length));
  }
}
const setPlayIcon = () => $('#pl-play use').setAttribute('href', audio.paused ? '#i-play' : '#i-pause');
audio.addEventListener('play', setPlayIcon);
audio.addEventListener('pause', setPlayIcon);
audio.addEventListener('ended', () => { if (P.i + 1 < P.items.length) playIndex(P.i + 1); });
audio.addEventListener('timeupdate', () => {
  const p = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
  const r = $('#pl-range');
  if (!r.matches(':active')) r.value = p;
  r.style.setProperty('--p', p / 10 + '%');
  $('#pl-cur').textContent = fmtTime(audio.currentTime);
  $('#pl-dur').textContent = fmtTime(audio.duration);
});
$('#pl-range').addEventListener('input', e => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });
$('#pl-play').onclick = () => (audio.paused ? audio.play() : audio.pause());
$('#pl-prev').onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : playIndex((P.i - 1 + P.items.length) % P.items.length));
$('#pl-next').onclick = () => playIndex((P.i + 1) % P.items.length);
$('#pl-close').onclick = () => { audio.pause(); audio.removeAttribute('src'); $('#player').hidden = true; };

// ---------------------------------------------------------------- file operations
function itemMenu(e, list, x, y) {
  if (!S.sel.has(e.name)) { S.sel.clear(); S.sel.add(e.name); S.anchor = e.name; render(); }
  const many = S.sel.size > 1;
  const p = S.perms;
  openMenu(x, y, [
    !many && { icon: e.dir ? 'folder' : KIND_ICON[kindOf(e)], label: t('open'), run: () => open(e, list) },
    p.read && { icon: 'download', label: many || e.dir ? t('downloadTar') : t('download'), run: downloadSel },
    !many && !e.dir && { icon: 'external', label: t('openNewTab'), run: () => window.open(urlOf(S.path, e.name, false), '_blank', 'noopener') },
    (p.move || p.delete) && '-',
    p.move && !many && { icon: 'pencil', label: t('rename'), run: renameSel },
    p.move && { icon: 'move', label: t('moveTo'), run: moveSel },
    p.delete && { icon: 'trash', label: t('del'), danger: true, run: deleteSel },
  ]);
}

function downloadSel() {
  const items = selectedEntries();
  if (items.length === 1 && !items[0].dir) { location.href = urlOf(S.path, items[0].name, false) + '?dl'; return; }
  location.href = enc(S.path) + '?tar&files=' + encodeURIComponent(items.map(e => e.name).join('/'));
}

async function mkdir() {
  const name = await askText(t('newFolder'), '', { ok: t('create'), label: t('folderName') });
  if (!name) return;
  try {
    await api(enc(S.path + name) + '?mkdir', { method: 'POST' });
    toast(t('created', name));
    await refresh();
  } catch (e) { toast(e.message, 'err'); }
}

async function renameSel() {
  const [e] = selectedEntries();
  if (!e) return;
  const name = await askText(t('rename'), e.name, { ok: t('rename'), selectStem: !e.dir });
  if (!name || name === e.name) return;
  try {
    await api(urlOf(S.path, e.name, false) + '?mv=' + encodeURIComponent(S.path + name), { method: 'POST' });
    S.sel.clear(); S.sel.add(name);
    toast(t('renamed'));
    await refresh();
  } catch (err) { toast(err.message, 'err'); }
}

async function moveItems(names, dest) {
  if (dest === S.path) return;
  let ok = 0;
  for (const n of names) {
    try { await api(urlOf(S.path, n, false) + '?mv=' + encodeURIComponent(dest + n), { method: 'POST' }); ok++; }
    catch (err) { toast(`${n}: ${err.message}`, 'err'); }
  }
  if (ok) toast(t('moved', ok, dest === '/' ? S.me.title : dest.split('/').filter(Boolean).pop()));
  S.sel.clear();
  await refresh();
}

async function moveSel() {
  const names = [...S.sel];
  const dest = await pickFolder(t('moveTitle', names), S.path, names);
  if (dest != null) moveItems(names, dest);
}

function pickFolder(title, start, exclude) {
  let cur = start;
  const head = h('div', { class: 'p-head' });
  const ul = h('ul');
  const excluded = new Set(exclude.map(n => start + n + '/'));
  async function show(p) {
    cur = p;
    const up = h('button', { class: 'icon-btn sm', type: 'button', title: t('up'), disabled: p === '/' ? true : null, onclick: () => show(p.replace(/[^/]+\/$/, '')) }, icon('left'));
    head.replaceChildren(up, icon('folder'), h('b', { text: p === '/' ? S.me.title : p }));
    ul.replaceChildren(h('li', { class: 'p-empty', text: t('loading') }));
    try {
      const d = await api(enc(p) + '?ls');
      const dirs = sorted(d.entries.filter(e => e.dir)).filter(e => !excluded.has(p + e.name + '/'));
      ul.replaceChildren(...(dirs.length ? dirs.map(e => h('li', {}, h('button', { type: 'button', onclick: () => show(p + e.name + '/') }, icon('folder'), e.name))) : [h('li', { class: 'p-empty', text: t('noSubfolders') })]));
    } catch (e) { ul.replaceChildren(h('li', { class: 'p-empty', text: e.message })); }
  }
  show(start);
  return dialog({
    title, wide: true,
    body: h('div', { class: 'picker' }, head, ul),
    actions: [{ label: t('cancel'), value: null }, { label: t('moveHere'), cls: 'primary', submit: true, value: () => cur }],
  });
}

async function deleteSel() {
  const items = selectedEntries();
  if (!items.length) return;
  const what = t('what', items);
  const hasDir = items.some(e => e.dir);
  if (!(await confirmBox(t('deleteTitle', what), hasDir ? t('deleteDirText') : t('deleteText')))) return;
  let ok = 0;
  for (const e of items) {
    try { await api(urlOf(S.path, e.name, false), { method: 'DELETE' }); ok++; }
    catch (err) { toast(`${e.name}: ${err.message}`, 'err'); }
  }
  if (ok) toast(ok === 1 ? t('deleted', what) : t('deletedN', ok));
  S.sel.clear();
  await refresh();
}

$('#mkdir-btn').onclick = mkdir;
$('#upload-btn').onclick = () => {
  const b = $('#upload-btn').getBoundingClientRect();
  openMenu(b.left, b.bottom + 6, [
    { icon: 'upload', label: t('uploadFiles'), run: () => $('#file-input').click() },
    { icon: 'folder-up', label: t('uploadFolder'), run: () => $('#dir-input').click() },
  ]);
};
$('#more-btn').onclick = () => {
  const b = $('#more-btn').getBoundingClientRect();
  openMenu(b.right - 210, b.bottom + 6, [
    S.perms.read && { icon: 'download', label: t('downloadFolder'), run: () => { location.href = enc(S.path) + '?tar'; } },
    S.perms.read && { icon: 'check', label: t('selectAll'), run: () => { S.entries.forEach(e => S.sel.add(e.name)); render(); } },
    { icon: 'up', label: t('refresh'), run: refresh },
  ]);
};
$('#sel-clear').onclick = () => { S.sel.clear(); render(); };
$('#selbar').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  ({ download: downloadSel, rename: renameSel, move: moveSel, delete: deleteSel })[b.dataset.act]();
});
for (const b of $$('[data-view]')) b.onclick = () => { S.view = b.dataset.view; store.set('view', S.view); render(); };

// ---------------------------------------------------------------- uploads
const U = { queue: [], active: 0, policy: null, asking: null, bytesTotal: 0, bytesDone: 0, count: 0, done: 0, failed: 0 };
const MAX_PARALLEL = 3;

function enqueue(files, base) {
  if (!files.length) return;
  if (U.active === 0 && !U.queue.some(q => q.state === 'queued')) Object.assign(U, { bytesTotal: 0, bytesDone: 0, count: 0, done: 0, failed: 0, policy: null });
  const panel = $('#uploads');
  panel.hidden = false;
  panel.classList.remove('collapsed');
  for (const { file, rel } of files) {
    const it = { file, dest: base + rel, loaded: 0, state: 'queued' };
    it.li = h('li', {}, fileIcon(kindOf({ name: file.name })),
      h('div', { style: 'min-width:0' }, h('div', { class: 'u-name', text: rel }), h('div', { class: 'u-sub', text: t('waiting', fmtSize(file.size)) }), h('div', { class: 'u-bar' }, h('i'))),
      h('span', { class: 'st' }));
    $('#up-list').append(it.li);
    U.queue.push(it);
    U.bytesTotal += file.size;
    U.count++;
  }
  updateTotals();
  pump();
}

function updateTotals() {
  const pct = U.bytesTotal ? (U.bytesDone / U.bytesTotal) * 100 : 100;
  $('#up-total-bar').style.width = pct + '%';
  const left = U.count - U.done - U.failed;
  $('#up-title').textContent = left > 0 ? t('uploading', left, Math.floor(pct)) : U.failed ? t('uploadedFailed', U.done, U.failed) : t('uploaded', U.done);
}

function pump() {
  while (U.active < MAX_PARALLEL) {
    const it = U.queue.find(q => q.state === 'queued');
    if (!it) break;
    send(it, false);
  }
  if (U.active === 0 && !U.queue.some(q => q.state === 'queued' || q.state === 'conflict')) {
    updateTotals();
    refresh();
  }
}

function setItem(it, sub, pct, cls) {
  it.li.className = cls || '';
  $('.u-sub', it.li).textContent = sub;
  if (pct != null) $('.u-bar i', it.li).style.width = pct + '%';
  $('.st', it.li).replaceChildren(cls === 'done' ? icon('check') : cls === 'fail' ? icon('x') : '');
}

function send(it, overwrite) {
  it.state = 'active';
  U.active++;
  const xhr = new XMLHttpRequest();
  it.xhr = xhr;
  const t0 = performance.now();
  xhr.open('PUT', enc(it.dest) + (overwrite ? '?overwrite' : ''));
  xhr.setRequestHeader('X-Requested-With', 'files');
  xhr.upload.onprogress = ev => {
    U.bytesDone += ev.loaded - it.loaded;
    it.loaded = ev.loaded;
    const speed = ev.loaded / Math.max(0.001, (performance.now() - t0) / 1000);
    setItem(it, t('progress', fmtSize(ev.loaded), fmtSize(it.file.size), fmtSize(speed)), (ev.loaded / (ev.total || 1)) * 100);
    updateTotals();
  };
  const finish = () => { U.active--; updateTotals(); pump(); };
  xhr.onload = async () => {
    if (xhr.status === 201) {
      U.bytesDone += it.file.size - it.loaded; it.loaded = it.file.size;
      it.state = 'done'; U.done++;
      setItem(it, t('doneSize', fmtSize(it.file.size)), 100, 'done');
      return finish();
    }
    let msg = t('uploadFailed');
    let raw = '';
    try { raw = JSON.parse(xhr.responseText).error || ''; } catch {}
    if (raw) msg = serverMsg(raw);
    if (xhr.status === 409 && !overwrite && !raw.startsWith('Something')) {
      U.active--;
      it.state = 'conflict';
      setItem(it, t('exists'), null);
      U.bytesDone -= it.loaded; it.loaded = 0;
      const choice = await resolveConflict(it);
      if (choice === 'replace') { it.state = 'queued'; send(it, true); return; }
      if (choice === 'keep') { it.dest = await freeName(it.dest); $('.u-name', it.li).textContent = it.dest.slice(it.dest.lastIndexOf('/') + 1); it.state = 'queued'; send(it, false); return; }
      U.bytesDone += it.file.size; it.state = 'skipped'; U.done++;
      setItem(it, t('skipped'), 100, '');
      updateTotals(); pump();
      return;
    }
    fail(it, msg);
    finish();
  };
  xhr.onerror = () => { fail(it, t('networkError')); finish(); };
  xhr.onabort = () => { fail(it, t('cancelled')); finish(); };
  xhr.send(it.file);
}
function fail(it, msg) {
  it.state = 'failed'; U.failed++;
  U.bytesDone += it.file.size - it.loaded; it.loaded = it.file.size;
  setItem(it, msg, 100, 'fail');
}

async function resolveConflict(it) {
  while (U.asking) await U.asking;
  if (U.policy) return U.policy;
  let release;
  U.asking = new Promise(r => (release = r));
  const all = h('input', { type: 'checkbox', class: 'cb' });
  const name = it.dest.slice(it.dest.lastIndexOf('/') + 1);
  const pending = U.queue.filter(q => q.state === 'queued').length;
  const choice = await dialog({
    title: t('conflictTitle'),
    text: t('conflictText', name),
    body: pending ? h('label', { class: 'check-line' }, all, t('applyAll')) : null,
    actions: [
      { label: t('skip'), value: () => 'skip' },
      { label: t('keepBoth'), value: () => 'keep' },
      S.perms.delete ? { label: t('replace'), cls: 'primary', value: () => 'replace' } : null,
    ].filter(Boolean),
  });
  const c = choice || 'skip';
  if (all.checked) U.policy = c;
  U.asking = null;
  release();
  return c;
}

async function freeName(dest) {
  const slash = dest.lastIndexOf('/');
  const dir = dest.slice(0, slash + 1), name = dest.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, extn = dot > 0 ? name.slice(dot) : '';
  let taken = new Set();
  try { taken = new Set((await api(enc(dir) + '?ls')).entries.map(e => e.name)); } catch {}
  for (let i = 1; ; i++) { const n = `${stem} (${i})${extn}`; if (!taken.has(n)) return dir + n; }
}

$('#up-close').onclick = () => {
  for (const it of U.queue) { if (it.state === 'active') it.xhr.abort(); if (it.state === 'queued') it.state = 'cancelled'; }
  U.queue = []; $('#up-list').replaceChildren(); $('#uploads').hidden = true;
};
$('#up-toggle').onclick = () => $('#uploads').classList.toggle('collapsed');
$('#file-input').onchange = e => { enqueue([...e.target.files].map(f => ({ file: f, rel: f.name })), S.path); e.target.value = ''; };
$('#dir-input').onchange = e => { enqueue([...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name })), S.path); e.target.value = ''; };

async function filesFromDrop(dt) {
  const out = [];
  const entries = [...dt.items].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files].map(f => ({ file: f, rel: f.name }));
  const readAll = r => new Promise(res => { const acc = []; const next = () => r.readEntries(b => { if (!b.length) res(acc); else { acc.push(...b); next(); } }, () => res(acc)); next(); });
  const walk = async (ent, prefix) => {
    if (ent.isFile) { const f = await new Promise(res => ent.file(res, () => res(null))); if (f) out.push({ file: f, rel: prefix + f.name }); }
    else if (ent.isDirectory) for (const c of await readAll(ent.createReader())) await walk(c, prefix + ent.name + '/');
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// ---------------------------------------------------------------- drag & drop
let dragDepth = 0, internalDrag = null;
const isFiles = e => [...(e.dataTransfer?.types || [])].includes('Files') && !internalDrag;
function dragStart(ev, e) {
  if (!S.sel.has(e.name)) { S.sel.clear(); S.sel.add(e.name); render(); }
  internalDrag = { names: [...S.sel], from: S.path };
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', internalDrag.names.join('\n'));
}
document.addEventListener('dragend', () => { internalDrag = null; $$('.drop-target').forEach(x => x.classList.remove('drop-target')); });
function dropTargetOf(ev) {
  const el = ev.target.closest && ev.target.closest('[data-drop]');
  if (!el) return null;
  if (internalDrag && internalDrag.names.some(n => el.dataset.drop === internalDrag.from + n + '/')) return null;
  return el;
}
document.addEventListener('dragenter', e => {
  if (isFiles(e) && S.perms.write && S.status === 'ok') {
    dragDepth++;
    $('#drop').classList.add('on');
    $('#drop-dest').textContent = t('dropTo', S.path === '/' ? S.me.title : S.path.split('/').filter(Boolean).pop());
  }
});
document.addEventListener('dragleave', e => { if (isFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('on'); } });
document.addEventListener('dragover', e => {
  const tg = dropTargetOf(e);
  $$('.drop-target').forEach(x => x !== tg && x.classList.remove('drop-target'));
  if (internalDrag) {
    if (tg) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tg.classList.add('drop-target'); }
    return;
  }
  if (isFiles(e) && S.perms.write) {
    e.preventDefault();
    if (tg) tg.classList.add('drop-target');
    $('#drop-dest').textContent = t('dropTo', tg ? tg.dataset.drop.split('/').filter(Boolean).pop() || S.me.title : S.path === '/' ? S.me.title : S.path.split('/').filter(Boolean).pop());
  }
});
document.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').classList.remove('on');
  const tg = dropTargetOf(e);
  $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
  if (internalDrag) {
    const d = internalDrag;
    internalDrag = null;
    if (tg) moveItems(d.names, tg.dataset.drop);
    return;
  }
  if (!S.perms.write || !e.dataTransfer) return;
  const base = tg ? tg.dataset.drop : S.path;
  enqueue(await filesFromDrop(e.dataTransfer), base);
});

// ---------------------------------------------------------------- account & theme
function renderAccount() {
  const a = $('#account');
  if (S.me.user) {
    const btn = h('button', { class: 'avatar', title: t('account'), onclick: () => {
      const b = btn.getBoundingClientRect();
      openMenu(b.right - 200, b.bottom + 6, [{ icon: 'logout', label: t('signOut'), run: logout }]);
    } }, h('i', { text: S.me.user[0] }), S.me.user);
    a.replaceChildren(btn);
  } else if (S.me.accounts) {
    a.replaceChildren(h('button', { class: 'btn', onclick: login }, icon('user'), t('signIn')));
  } else a.replaceChildren();
}
async function login() {
  const user = h('input', { class: 'input', autocomplete: 'username', name: 'username', autocapitalize: 'off', spellcheck: 'false' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', name: 'password' });
  const err = h('p', { class: 'err' });
  let form;
  const submit = h('button', { type: 'submit', class: 'btn primary' }, t('signIn'));
  const body = h('div', {}, h('label', { class: 'field' }, h('span', { text: t('userName') }), user), h('label', { class: 'field' }, h('span', { text: t('password') }), pass), err);
  const p = dialog({ title: t('signIn'), text: t('signInTo', S.me.title), body, actions: [{ label: t('cancel'), value: null }], init: f => { form = f; user.focus(); return true; } });
  form.querySelector('.actions').append(submit);
  form.onsubmit = async ev => {
    ev.preventDefault();
    submit.disabled = true; err.textContent = '';
    try {
      await api('/.files/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user.value.trim(), pass: pass.value }) });
      form.closeWith(true);
    } catch (e) { err.textContent = e.message; submit.disabled = false; pass.select(); }
  };
  if (await p) { await loadMe(); if (S.me.user) toast(t('welcome', S.me.user)); refresh(); }
}
async function logout() {
  try { await api('/.files/logout', { method: 'POST' }); } catch {}
  await loadMe();
  refresh();
}
async function loadMe() {
  try { S.me = await api('/.files/me'); } catch {}
  renderAccount();
}

function applyThemeIcon() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('#theme-btn use').setAttribute('href', cur === 'dark' ? '#i-sun' : '#i-moon');
}
$('#theme-btn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
  applyThemeIcon();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeIcon);

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  const typing = e.target.closest('input, textarea, [contenteditable]');
  if (dialogOpen) return;
  if (!$('#viewer').hidden) {
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') stepViewer(-1);
    else if (e.key === 'ArrowRight') stepViewer(1);
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#menu').hidden) return closeMenu();
    if (S.search) return exitSearch();
    if (S.sel.size) { S.sel.clear(); render(); }
    return;
  }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && S.status === 'ok' && !S.search) { e.preventDefault(); S.entries.forEach(x => S.sel.add(x.name)); render(); }
  else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && S.sel.size && S.perms.delete) deleteSel();
  else if (e.key === 'F2' && S.sel.size === 1 && S.perms.move) { e.preventDefault(); renameSel(); }
  else if (e.key === 'Backspace' && S.path !== '/') load(S.path.replace(/[^/]+\/$/, ''));
});

$('#lang-btn').onclick = () => {
  LANG = LANG === 'zh' ? 'en' : 'zh';
  store.set('lang', LANG);
  setFormatters();
  applyStatic();
  renderCrumbs();
  renderAccount();
  render();
  if (!$('#uploads').hidden) updateTotals();
};

// ---------------------------------------------------------------- boot
applyStatic();
applyThemeIcon();
S.path = currentPathFromUrl();
renderCrumbs();
loadMe().then(renderCrumbs);
load(S.path, { push: false });
})();
