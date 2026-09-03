const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STORAGE_USERS = 'ts_users';
const STORAGE_LINES = 'ts_lines';
const STORAGE_SESSION = 'ts_session';
const STORAGE_ACTIVE = 'ts_active_line';
const STORAGE_THEME = 'ts_theme';

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#f97316',
  '#10b981', '#14b8a6', '#3b82f6', '#06b6d4', '#84cc16', '#64748b'
];

let users = [];
let lines = [];
let currentUser = null;
let activeLineId = null;
let currentWorkspace = null;
let selectedTabId = null;
let draggingState = null;
let didDrag = false;
let markerActive = false;
let editingLineId = null; // for line modal create/edit
let undoStack = [];
let redoStack = [];

let syncConfig = null;
let syncApi = null;
let syncing = false;

function toast(msg, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTimeOnly(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => { const h = x.toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

function shadeColor(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent);
  return rgbToHex(Math.round((t - r) * p) + r, Math.round((t - g) * p) + g, Math.round((t - b) * p) + b);
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadLocal() {
  try { users = JSON.parse(localStorage.getItem(STORAGE_USERS)) || []; } catch { users = []; }
  try { lines = JSON.parse(localStorage.getItem(STORAGE_LINES)) || []; } catch { lines = []; }
  currentUser = localStorage.getItem(STORAGE_SESSION);
  activeLineId = localStorage.getItem(STORAGE_ACTIVE);
}

function saveUsers() { localStorage.setItem(STORAGE_USERS, JSON.stringify(users)); }
function saveLines() { localStorage.setItem(STORAGE_LINES, JSON.stringify(lines)); }
function getActiveLine() { return lines.find(l => l.id === activeLineId) || null; }

// ══════════ SUPABASE SYNC (tiempo real automático) ══════════
const SB_TABLE = 'progress';
const SB_ROW_ID = 1;
const STORAGE_SYNC = 'ts_sync';

// Datos por defecto del proyecto Supabase (podés cambiarlos en el modal Nube)
const DEFAULT_SB_URL = 'https://jmpvmyawdazwzoidsyao.supabase.co';
const DEFAULT_SB_KEY = 'sb_publishable_QvYRrigkDwWvCA7IN7Zi9A_cB_xoBgQ';

function loadSyncConfig() {
  try { syncConfig = JSON.parse(localStorage.getItem(STORAGE_SYNC)) || null; } catch { syncConfig = null; }
  // If the user hasn't set anything yet, use the built-in project defaults
  if (!syncConfig) syncConfig = { url: DEFAULT_SB_URL, key: DEFAULT_SB_KEY, lastSync: null };
  syncApi = null;
  if (syncConfig && window.supabase) {
    try {
      syncApi = window.supabase.createClient(syncConfig.url, syncConfig.key);
    } catch { syncApi = null; }
  }
}

function persistSyncConfig() {
  if (syncConfig) {
    localStorage.setItem(STORAGE_SYNC, JSON.stringify(syncConfig));
    syncApi = window.supabase ? (() => { try { return window.supabase.createClient(syncConfig.url, syncConfig.key); } catch { return null; } })() : null;
  } else {
    localStorage.removeItem(STORAGE_SYNC);
    syncApi = null;
  }
  updateSyncBadge();
}

function sbConnected() { return !!syncApi; }

function updateSyncBadge() {
  const dot = document.querySelector('.sync-badge-dot');
  if (!dot) return;
  dot.className = 'sync-badge-dot';
  if (syncing) { dot.classList.add('busy'); return; }
  if (sbConnected()) dot.classList.add('synced');
}

function openSyncModal() {
  $('#sync-url').value = syncConfig ? syncConfig.url : DEFAULT_SB_URL;
  $('#sync-token').value = syncConfig ? syncConfig.key : DEFAULT_SB_KEY;
  $('#sync-clear').style.display = syncConfig ? '' : 'none';
  $('#sync-status').textContent = syncConfig
    ? 'Conectado a la nube. ' + (syncConfig.lastSync ? `Última sincronización: ${formatDate(syncConfig.lastSync)}` : '')
    : 'Sin conectar todavía. Completá los datos y tocá Probar.';
  $('#sync-status').className = 'sync-status' + (sbConnected() ? ' ok' : '');
  $('#sync-modal').style.display = '';
  $('#sync-url').focus();
}

function closeSyncModal() {
  $('#sync-modal').style.display = 'none';
}

function saveSyncSettings() {
  const url = $('#sync-url').value.trim();
  const key = $('#sync-token').value.trim();
  if (!url || !key) { toast('Completá el URL y la clave anon', 'error'); return; }
  syncConfig = { url, key, lastSync: syncConfig ? syncConfig.lastSync : null };
  persistSyncConfig();
  toast('Conexión guardada', 'success');
  closeSyncModal();
  connectRealtime();
  pushProgress(); // sube el progreso local de una vez
}

function testSyncConnection() {
  const statusEl = $('#sync-status');
  const url = $('#sync-url').value.trim();
  const key = $('#sync-token').value.trim();
  if (!url || !key) { statusEl.textContent = 'Completá URL y clave anon'; statusEl.className = 'sync-status err'; return; }
  statusEl.textContent = 'Probando conexión...';
  statusEl.className = 'sync-status';
  let c;
  try { c = window.supabase.createClient(url, key); } catch { statusEl.textContent = 'Datos no válidos'; statusEl.className = 'sync-status err'; return; }
  c.from(SB_TABLE).select('data').eq('id', SB_ROW_ID).maybeSingle()
    .then(({ error }) => {
      if (error) {
        statusEl.textContent = 'Error: ' + (error.message || 'sin permisos. ¿Corriste el script SQL?');
        statusEl.className = 'sync-status err';
      } else {
        statusEl.textContent = 'Conexión exitosa. Ejecutá Guardar para subir tu progreso.';
        statusEl.className = 'sync-status ok';
      }
    })
    .catch(() => { statusEl.textContent = 'No se pudo conectar. Revisá el URL.'; statusEl.className = 'sync-status err'; });
}

let sbChannel = null;
let applyingRemote = false;

function progressPayload() {
  return {
    app: 'timeline-studio',
    version: 1,
    lines,
    users,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser || 'anónimo',
  };
}

// Sube el progreso local a la nube
function pushProgress() {
  if (!sbConnected() || syncing) return;
  syncing = true;
  updateSyncBadge();
  const payload = progressPayload();
  syncApi.from(SB_TABLE).update({ data: payload, updated_at: new Date().toISOString() }).eq('id', SB_ROW_ID)
    .then(({ error }) => {
      if (error) {
        // If row doesn't exist, insert it
        return syncApi.from(SB_TABLE).insert({ id: SB_ROW_ID, data: payload, updated_at: new Date().toISOString() })
          .then(({ error: e2 }) => { if (e2) throw e2; })
          .catch(() => { throw error; });
      }
    })
    .then(() => {
      if (syncConfig) syncConfig.lastSync = new Date().toISOString();
      localStorage.setItem(STORAGE_SYNC, JSON.stringify(syncConfig));
    })
    .catch((err) => {
      console.warn('push error', err);
      toast('Error al guardar en la nube', 'error');
    })
    .finally(() => {
      syncing = false;
      updateSyncBadge();
    });
}

// Baja el progreso de la nube y aplica en los datos locales
function pullProgress() {
  if (!sbConnected() || syncing) return Promise.resolve(false);
  syncing = true;
  updateSyncBadge();
  return syncApi.from(SB_TABLE).select('data').eq('id', SB_ROW_ID).maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error;
      if (!data || !data.data) return false;
      const remote = data.data;
      const changed = applyRemote(remote);
      if (changed) {
        if (syncConfig) syncConfig.lastSync = new Date().toISOString();
        localStorage.setItem(STORAGE_SYNC, JSON.stringify(syncConfig));
      }
      return changed;
    })
    .catch((err) => {
      console.warn('pull error', err);
      return false;
    })
    .finally(() => {
      syncing = false;
      updateSyncBadge();
    });
}

// Aplica los datos remotos en los locales (si son más recientes)
function applyRemote(remote) {
  let changed = false;
  if (Array.isArray(remote.lines) && (remote.updatedAt || remote.updated_by)) {
    applyingRemote = true;
    lines = remote.lines.map(l => ({ tabs: [], history: [], ...l }));
    saveLines();
    changed = true;
  }
  if (Array.isArray(remote.users)) {
    users = remote.users;
    saveUsers();
    changed = true;
  }
  if (changed) {
    renderLinesList();
    if (currentWorkspace) renderTabs();
  }
  return changed;
}

// Escucha cambios en tiempo real desde cualquier dispositivo
function connectRealtime() {
  if (!sbConnected()) return;
  try { if (sbChannel) sbChannel.unsubscribe(); } catch {}
  sbChannel = syncApi
    .channel('progress-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: SB_TABLE, filter: `id=eq.${SB_ROW_ID}` }, (payload) => {
      if (payload && payload.new && payload.new.data) {
        // Avoid echo loop: only apply if it changes something real
        const remote = payload.new.data;
        const remoteStr = JSON.stringify(remote);
        const localStr = JSON.stringify(progressPayload());
        if (remoteStr !== localStr) applyRemote(remote);
      }
    })
    .subscribe();
}

// Auto-guardar: llama al pulsar cambios locales
function notifyChanged() {
  if (!sbConnected()) return;
  // Debounce a bit to group rapid changes
  clearTimeout(window.__sbPushTimer);
  window.__sbPushTimer = setTimeout(pushProgress, 300);
}

function setupSync() {
  loadSyncConfig();
  $('#sync-close').addEventListener('click', closeSyncModal);
  $('#sync-save').addEventListener('click', saveSyncSettings);
  $('#sync-test').addEventListener('click', testSyncConnection);
  $('#sync-token-toggle').addEventListener('click', () => {
    const input = $('#sync-token');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('#sync-clear').addEventListener('click', () => {
    syncConfig = null;
    persistSyncConfig();
    toast('Conexión a la nube desconectada', 'success');
    closeSyncModal();
  });
  if (sbConnected()) connectRealtime();
}

function doSaveAll() {
  if (sbConnected()) {
    pushProgress();
  } else {
    saveLocalFile();
  }
}

// ── Hook points: call notifyChanged() after any local data change ──
const _origSaveLines = saveLines;
saveLines = function () {
  _origSaveLines();
  if (!applyingRemote) notifyChanged();
};

// ══════════ DARK MODE ══════════
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_THEME, theme);
}
function setupTheme() {
  const saved = localStorage.getItem(STORAGE_THEME) || 'light';
  applyTheme(saved);

  const toggle = (e) => {
    e.stopPropagation();
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  const loginBtn = $('#global-theme-btn-login');
  const menuBtn = $('#theme-btn');
  if (loginBtn) loginBtn.addEventListener('click', toggle);
  if (menuBtn) menuBtn.addEventListener('click', toggle);
}

// ══════════ LOGIN ══════════
function renderUserList() {
  const list = $('#user-list');
  list.innerHTML = '';

  if (users.length === 0) {
    list.innerHTML = '<li style="justify-content:center;color:var(--text-tertiary);font-size:13px;background:transparent;border:none;cursor:default">No hay usuarios todavía. Crea el primero abajo.</li>';
    $('#new-user-btn').style.display = '';
  }

  users.forEach((u) => {
    const li = document.createElement('li');
    li.dataset.user = u.id;
    li.innerHTML = `
      <span class="user-avatar">${escapeHtml(u.name.charAt(0).toUpperCase())}</span>
      <span class="user-name">${escapeHtml(u.name)}</span>
      <span class="user-count">${countUserEdits(u.name)} ediciones</span>
    `;
    li.addEventListener('click', () => selectUser(u));
    list.appendChild(li);
  });
}

function countUserEdits(name) {
  let count = 0;
  lines.forEach(l => (l.history || []).forEach(h => { if (h.user === name) count++; }));
  return count;
}

function selectUser(u) {
  currentUser = u.name;
  localStorage.setItem(STORAGE_SESSION, currentUser);
  showMainMenu();
}

function showLogin() {
  $('#login-screen').style.display = 'flex';
  $('#main-menu').style.display = 'none';
  $('#workspace').style.display = 'none';
  renderUserList();
}

function setupLogin() {
  const form = $('#new-user-form');
  const input = $('#new-user-input');

  $('#new-user-btn').addEventListener('click', () => { form.style.display = ''; input.focus(); });

  const doCreate = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
      toast('Ese usuario ya existe', 'error');
      return;
    }
    const u = { id: generateId(), name, createdAt: new Date().toISOString() };
    users.push(u);
    saveUsers();
    input.value = '';
    form.style.display = 'none';
    renderUserList();
    selectUser(u);
  };

  $('#new-user-confirm').addEventListener('click', doCreate);
  $('#new-user-cancel').addEventListener('click', () => { form.style.display = 'none'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

// ══════════ USER MENU (cambiar/crear usuario) ══════════
function renderUserMenuList() {
  const list = $('#user-menu-list');
  list.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    const isCurrent = currentUser === u.name;
    li.innerHTML = `
      <span class="user-avatar">${escapeHtml(u.name.charAt(0).toUpperCase())}</span>
      <span class="user-name">${escapeHtml(u.name)}</span>
      <span class="user-count">${isCurrent ? 'actual' : ''}</span>
    `;
    li.addEventListener('click', () => {
      selectUser(u);
      $('#user-menu-modal').style.display = 'none';
    });
    list.appendChild(li);
  });
}

function openUserMenu() {
  renderUserMenuList();
  $('#user-menu-input').value = '';
  $('#user-menu-modal').style.display = '';
}

function setupUserMenu() {
  $('#mm-user-badge').addEventListener('click', (e) => { e.stopPropagation(); openUserMenu(); });
  $('#user-menu-close').addEventListener('click', () => { $('#user-menu-modal').style.display = 'none'; });

  const doCreate = () => {
    const name = $('#user-menu-input').value.trim();
    if (!name) { $('#user-menu-input').focus(); return; }
    if (users.find(u => u.name.toLowerCase() === name.toLowerCase())) {
      toast('Ese usuario ya existe', 'error');
      return;
    }
    const u = { id: generateId(), name, createdAt: new Date().toISOString() };
    users.push(u);
    saveUsers();
    selectUser(u);
    $('#user-menu-modal').style.display = 'none';
  };

  $('#user-menu-create').addEventListener('click', doCreate);
  $('#user-menu-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doCreate(); });
}

// ══════════ MAIN MENU ══════════
function showMainMenu() {
  $('#login-screen').style.display = 'none';
  $('#workspace').style.display = 'none';
  $('#main-menu').style.display = '';
  $('#mm-user-badge').textContent = currentUser || '';
  updateSyncBadge();
  renderLinesList();
}

function exportAll() {
  const blob = new Blob([JSON.stringify({ lines }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'timeline-studio-respaldo.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Respaldo exportado', 'success');
}

function importBackup() {
  const input = document.getElementById('import-file');
  input.value = '';
  input.click();
}

function setupMainMenuActions() {
  $('#create-line-btn').addEventListener('click', openCreateLineModal);
  $('#export-all-btn').addEventListener('click', exportAll);
  $('#import-btn').addEventListener('click', importBackup);
  $('#sync-open-btn').addEventListener('click', openSyncModal);
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = data.lines || data;
        if (!Array.isArray(incoming)) throw new Error('Formato no válido');
        if (confirm(`¿Reemplazar todas las líneas actuales (${lines.length}) con las del archivo (${incoming.length})?`)) {
          lines = incoming.map(l => ({ tabs: [], history: [], ...l }));
          if (Array.isArray(data.users)) users = data.users;
          saveUsers();
          saveLines();
          renderLinesList();
          toast('Respaldo importado', 'success');
        }
      } catch {
        toast('Archivo de respaldo inválido', 'error');
      }
    };
    reader.readAsText(file);
  });
}

function renderLinesList() {
  const list = $('#mm-lines-list');
  list.innerHTML = '';

  if (lines.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px 0">Todavía no tenés líneas de tiempo.<br>Crea la primera con el botón de abajo.</div>';
  }

  lines.forEach((line) => {
    const card = document.createElement('div');
    card.className = 'line-card';
    const tabCount = (line.tabs || []).length;
    card.innerHTML = `
      <div class="line-swatch" style="background:${line.color || '#6366f1'}"></div>
      <div class="line-card-info">
        <div class="line-card-title">${escapeHtml(line.title)}</div>
        <div class="line-card-meta">${tabCount} pestaña${tabCount === 1 ? '' : 's'}</div>
      </div>
      <div class="line-card-actions">
        <button class="icon-btn edit" data-action="edit" title="Editar título">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-action="delete" title="Eliminar línea">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <span class="line-card-chevron">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </span>
    `;

    card.addEventListener('click', () => openWorkspace(line.id));
    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); openEditLineModal(line); });
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); deleteLine(line); });

    list.appendChild(card);
  });
}

function deleteLine(line) {
  if (!confirm(`¿Eliminar la línea de tiempo "${line.title}"? Esta acción no se puede deshacer.`)) return;
  lines = lines.filter(l => l.id !== line.id);
  if (activeLineId === line.id) { activeLineId = null; localStorage.removeItem(STORAGE_ACTIVE); }
  saveLines();
  renderLinesList();
  toast('Línea eliminada', 'success');
}

// ══════════ CREATE / EDIT LINE MODAL ══════════
function setupLineModal() {
  const syncPreview = () => {
    const r = parseInt($('#line-r').value);
    const g = parseInt($('#line-g').value);
    const b = parseInt($('#line-b').value);
    $('#line-r-val').textContent = r;
    $('#line-g-val').textContent = g;
    $('#line-b-val').textContent = b;
    const hex = rgbToHex(r, g, b);
    $('#line-preview-bar').style.background = hex;
    $('#line-color').value = hex;
  };

  $('#line-r').addEventListener('input', syncPreview);
  $('#line-g').addEventListener('input', syncPreview);
  $('#line-b').addEventListener('input', syncPreview);
  $('#line-color').addEventListener('input', (e) => {
    const { r, g, b } = hexToRgb(e.target.value);
    $('#line-r').value = r; $('#line-r-val').textContent = r;
    $('#line-g').value = g; $('#line-g-val').textContent = g;
    $('#line-b').value = b; $('#line-b-val').textContent = b;
    $('#line-preview-bar').style.background = e.target.value;
  });

  $('#line-close').addEventListener('click', closeLineModal);
  $('#line-cancel').addEventListener('click', closeLineModal);
  $('#line-save').addEventListener('click', saveLineModal);
  $('#line-delete').addEventListener('click', deleteLineFromModal);
  $('#line-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLineModal(); });
}

function setLineColor(hex) {  const { r, g, b } = hexToRgb(hex);
  $('#line-color').value = hex;
  $('#line-r').value = r; $('#line-r-val').textContent = r;
  $('#line-g').value = g; $('#line-g-val').textContent = g;
  $('#line-b').value = b; $('#line-b-val').textContent = b;
  $('#line-preview-bar').style.background = hex;
}

function getLineColor() {
  return rgbToHex(parseInt($('#line-r').value), parseInt($('#line-g').value), parseInt($('#line-b').value));
}

function setBgColor(hex) {
  $('#project-bg-color').value = hex;
}

function getBgColor() {
  const v = $('#project-bg-color').value;
  return v || '#ffffff';
}

function openCreateLineModal() {
  editingLineId = null;
  $('#line-modal-title').textContent = 'Nueva Línea de Tiempo';
  $('#line-title').value = '';
  setLineColor('#6366f1');
  setBgColor('#ffffff');
  $$('#line-modal .present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === '#ffffff'));
  $('#line-delete').style.display = 'none';
  $('#line-save').textContent = 'Crear';
  $('#line-modal').style.display = '';
  $('#line-title').focus();
}

function openEditLineModal(line) {
  editingLineId = line.id;
  $('#line-modal-title').textContent = 'Editar Proyecto';
  $('#line-title').value = line.title || '';
  setLineColor(line.color || '#6366f1');
  const bg = line.bgColor || '#ffffff';
  setBgColor(bg);
  $$('#line-modal .present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === bg));
  $('#line-delete').style.display = '';
  $('#line-save').textContent = 'Guardar';
  $('#line-modal').style.display = '';
  $('#line-title').focus();
}

function closeLineModal() {
  $('#line-modal').style.display = 'none';
  editingLineId = null;
}

function saveLineModal() {
  const title = $('#line-title').value.trim();
  if (!title) { toast('Ingresa el título', 'error'); $('#line-title').focus(); return; }
  const color = getLineColor();
  const bgColor = getBgColor();
  const now = new Date().toISOString();
  const isEditing = !!editingLineId;
  let createdLineId = null;

  if (editingLineId) {
    const line = lines.find(l => l.id === editingLineId);
    if (line) {
      recordHistory(line, { type: 'edit_proyecto', detail: 'Proyecto actualizado (título, línea o fondo)' });
      line.title = title;
      line.color = color;
      line.bgColor = bgColor;
      line.modifiedBy = currentUser;
      line.modifiedAt = now;
      saveLines();
      toast('Proyecto actualizado', 'success');
      if (activeLineId === line.id && currentWorkspace) rebuildWorkspaceVisuals();
    }
  } else {
    const line = {
      id: generateId(), title, color, bgColor,
      tabs: [], history: [], createdBy: currentUser, createdAt: now, modifiedBy: currentUser, modifiedAt: now,
    };
    lines.push(line);
    createdLineId = line.id;
    saveLines();
    toast('Línea creada', 'success');
  }

  closeLineModal();
  renderLinesList();

  if (!isEditing && createdLineId) {
    openWorkspace(createdLineId);
  }
}

function deleteLineFromModal() {
  if (!editingLineId) return;
  if (!confirm('¿Eliminar esta línea de tiempo?')) return;
  const line = lines.find(l => l.id === editingLineId);
  if (!line) return;
  lines = lines.filter(l => l.id !== line.id);
  if (activeLineId === line.id) { activeLineId = null; localStorage.removeItem(STORAGE_ACTIVE); }
  saveLines();
  closeLineModal();
  if (currentWorkspace && currentWorkspace.lineId === line.id) {
    showMainMenu();
  } else {
    renderLinesList();
  }
  toast('Línea eliminada', 'success');
}

// ══════════ HISTORY (per line) ══════════
function recordHistory(line, entry) {
  if (!line.history) line.history = [];
  line.history.push({
    ...entry,
    user: currentUser,
    time: new Date().toISOString(),
  });
  if (line.history.length > 200) line.history.splice(0, line.history.length - 200);
}

// ══════════ UNDO / REDO ══════════
function pushUndo() {
  const line = getActiveLine();
  if (!line) return;
  undoStack.push(JSON.stringify(line.tabs));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

function undo() {
  const line = getActiveLine();
  if (!line) return;
  if (undoStack.length === 0) { toast('No hay cambios para deshacer', 'info'); return; }
  redoStack.push(JSON.stringify(line.tabs));
  line.tabs = JSON.parse(undoStack.pop());
  saveLines();
  renderTabs();
  toast('Cambio deshecho', 'info');
}

function redo() {
  const line = getActiveLine();
  if (!line) return;
  if (redoStack.length === 0) { toast('No hay cambios para rehacer', 'info'); return; }
  undoStack.push(JSON.stringify(line.tabs));
  line.tabs = JSON.parse(redoStack.pop());
  saveLines();
  renderTabs();
  toast('Cambio rehecho', 'info');
}

// ══════════ WORKSPACE ══════════
function openWorkspace(lineId) {
  activeLineId = lineId;
  localStorage.setItem(STORAGE_ACTIVE, activeLineId);
  selectedTabId = null;
  undoStack = [];
  redoStack = [];

  const line = lines.find(l => l.id === lineId);
  if (!line) return;
  if (!line.history) line.history = [];
  if (!line.tabs) line.tabs = [];

  $('#login-screen').style.display = 'none';
  $('#main-menu').style.display = 'none';
  $('#workspace').style.display = '';

  const ws = $('#workspace');
  buildWorkspaceHTML(ws, line);
  currentWorkspace = {
    lineId: line.id,
    body: ws.querySelector('#ws-body'),
    stage: ws.querySelector('#ws-stage'),
    mainLine: ws.querySelector('#ws-main-line'),
    scrollbar: ws.querySelector('#ws-scrollbar'),
    scrollbarThumb: ws.querySelector('#ws-scrollbar-thumb'),
    drawer: ws.querySelector('#ws-drawer'),
    drawerList: ws.querySelector('#ws-drawer-list'),
    drawerOverlay: ws.querySelector('#ws-drawer-overlay'),
  };

  rebuildWorkspaceVisuals();
  bindWorkspaceEvents();

  if (line.tabs.length === 0) {
    addTabAt(0, null, true);
  } else {
    renderTabs();
  }
}

function buildWorkspaceHTML(ws, line) {
  ws.innerHTML = `
    <header class="ws-header glass-panel">
      <div class="ws-header-left">
        <button class="ws-back-btn" id="ws-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Volver
        </button>
        <span class="ws-line-title">${escapeHtml(line.title)}</span>
      </div>
      <div class="ws-header-right">
        <span class="user-badge clickable ws-user-badge" id="ws-user-badge" title="Cambiar de usuario">${escapeHtml(currentUser)}</span>
        <button class="ws-menu-btn" id="ws-menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="ws-scroll-wrap">
      <div class="ws-scrollbar" id="ws-scrollbar"><div class="ws-scrollbar-thumb" id="ws-scrollbar-thumb"></div></div>
    </div>

    <div class="ws-body" id="ws-body">
      <div class="ws-stage" id="ws-stage">
        <div class="ws-main-line" id="ws-main-line"></div>
      </div>
    </div>

    <div class="ws-toolbar glass-panel">
      <button class="ws-tool-btn" data-tool="add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Nueva</span>
      </button>
      <button class="ws-tool-btn" data-tool="edit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        <span>Editar</span>
      </button>
      <button class="ws-tool-btn" data-tool="undo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        <span>Deshacer</span>
      </button>
      <button class="ws-tool-btn" data-tool="redo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Rehacer</span>
      </button>
      <button class="ws-tool-btn" data-tool="save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span>Guardar</span>
      </button>
      <button class="ws-tool-btn" data-tool="sync">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Nube</span>
      </button>
      <button class="ws-tool-btn" data-tool="history">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Historial</span>
      </button>
      <button class="ws-tool-btn" data-tool="info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Info</span>
      </button>
    </div>

    <div class="ws-drawer" id="ws-drawer">
      <div class="ws-drawer-header">
        <h3>Pestañas</h3>
        <button class="icon-btn" id="ws-drawer-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <ul class="ws-drawer-list" id="ws-drawer-list"></ul>
    </div>
    <div class="ws-drawer-overlay" id="ws-drawer-overlay"></div>
  `;
}

function rebuildWorkspaceVisuals() {
  const line = getActiveLine();
  if (!line || !currentWorkspace) return;

  const color = line.color || '#6366f1';
  const darker = shadeColor(color, -0.55);

  // Individual background: use bgColor if set, otherwise a gradient derived from line color
  let bgStyle;
  if (line.bgColor) {
    bgStyle = line.bgColor;
  } else {
    bgStyle = `linear-gradient(160deg, ${rgba(color, 0.5)} 0%, ${rgba(darker, 0.8)} 60%, ${rgba(shadeColor(color, -0.7), 0.95)} 100%)`;
  }

  document.getElementById('workspace').style.background = bgStyle;
  const lineEl = document.getElementById('ws-main-line');
  if (lineEl) lineEl.style.background = darker;
  const titleEl = document.querySelector('.ws-line-title');
  if (titleEl) titleEl.textContent = line.title;
}

function bindWorkspaceEvents() {
  const ws = $('#workspace');

  ws.querySelector('#ws-back').addEventListener('click', showMainMenu);
  ws.querySelector('#ws-user-badge').addEventListener('click', (e) => { e.stopPropagation(); openUserMenu(); });
  ws.querySelector('#ws-menu').addEventListener('click', () => {
    currentWorkspace.drawer.classList.add('open');
    currentWorkspace.drawerOverlay.classList.add('visible');
    renderDrawer();
  });
  ws.querySelector('#ws-drawer-close').addEventListener('click', closeDrawer);
  ws.querySelector('#ws-drawer-overlay').addEventListener('click', closeDrawer);

  // Toolbar
  ws.querySelector('[data-tool="add"]').addEventListener('click', () => createNewTabAtEnd());
  ws.querySelector('[data-tool="edit"]').addEventListener('click', () => { const l = getActiveLine(); if (l) openEditLineModal(l); });
  ws.querySelector('[data-tool="undo"]').addEventListener('click', undo);
  ws.querySelector('[data-tool="redo"]').addEventListener('click', redo);
  ws.querySelector('[data-tool="save"]').addEventListener('click', doSaveAll);
  ws.querySelector('[data-tool="sync"]').addEventListener('click', () => { if (syncApi) { pushProgress(); } else { openSyncModal(); } });
  ws.querySelector('[data-tool="history"]').addEventListener('click', () => openHistory());
  ws.querySelector('[data-tool="info"]').addEventListener('click', () => openHelp());

  setupMainLineClick();
  setupBodyScroll();
  setupDragDrop();
}

function createNewTabAtEnd() {
  const line = getActiveLine();
  if (!line) return;
  pushUndo();
  recordHistory(line, { type: 'crear_pestana', detail: 'Pestaña creada' });
  const tab = addTabAt(line.tabs.length, '', false);
  if (tab) openTabEditor(tab);
}

// ══════════ RENDER TABS ══════════
function renderTabs() {
  const line = getActiveLine();
  if (!line || !currentWorkspace) return;

  $$('.tab-node', currentWorkspace.stage).forEach(n => n.remove());
  removeMarker();

  const tabs = line.tabs || [];
  const spacing = 260;
  const total = Math.max(tabs.length * spacing + spacing, currentWorkspace.stage.clientWidth);

  currentWorkspace.stage.style.width = (tabs.length === 0 ? currentWorkspace.stage.clientWidth : total) + 'px';
  currentWorkspace.mainLine.style.width = (tabs.length === 0 ? '100%' : (total * 0.86) + 'px');
  currentWorkspace.mainLine.style.left = (total * 0.07) + 'px';

  tabs.forEach((tab, idx) => {
    const centerX = 60 + idx * spacing;
    const node = document.createElement('div');
    node.className = 'tab-node';
    node.dataset.tabId = tab.id;
    node.style.left = centerX + 'px';

    const hasDesc = tab.description && tab.description.trim().length > 0;
    const cardUp = (idx % 2 === 0);

    node.innerHTML = `
      <div class="tab-parts ${cardUp ? 'up' : 'down'}">
        <div class="tab-card">
          <div class="tab-edge" style="background:${tab.color}"></div>
          <div class="tab-title-text">${escapeHtml(tab.title || 'Sin título')}</div>
          ${hasDesc
            ? `<div class="tab-desc-preview">${escapeHtml(tab.description)}</div>`
            : `<div class="tab-empty">${escapeHtml(tab.title ? 'Sin descripción' : 'Crea tu primera pestaña')}</div>`}
        </div>
        <div class="tab-stem"></div>
        <div class="tab-leg" style="background:${tab.color}"></div>
      </div>
    `;

    node.style[cardUp ? 'bottom' : 'top'] = '50%';

    let clicks = 0, timer = null;
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (didDrag) { didDrag = false; return; }
      clicks++;
      if (clicks === 1) {
        timer = setTimeout(() => { toggleTabPreview(tab); clicks = 0; }, 250);
      } else {
        clearTimeout(timer); clicks = 0; openTabEditor(tab);
      }
    });
    node.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(timer); clicks = 0; openTabEditor(tab);
    });

    const leg = node.querySelector('.tab-leg');
    leg.addEventListener('mousedown', (e) => startDrag(e, tab.id));
    leg.addEventListener('touchstart', (e) => startDrag(e, tab.id), { passive: false });

    currentWorkspace.stage.appendChild(node);
  });

  renderDrawer();
  updateScrollbar();
}

function toggleTabPreview(tab) {
  if (!currentWorkspace) return;
  const node = currentWorkspace.stage.querySelector(`.tab-node[data-tab-id="${tab.id}"]`);
  if (!node) return;
  const expanded = node.classList.toggle('expanded');
  const descEl = node.querySelector('.tab-desc-preview');
  if (!descEl) return;
  if (expanded) {
    descEl.classList.remove('tab-desc-preview'); descEl.classList.add('tab-desc-full');
  } else {
    descEl.classList.add('tab-desc-preview'); descEl.classList.remove('tab-desc-full');
  }
}

// ══════════ ADD A TAB ══════════
function addTabAt(index, title, isFirst) {
  const line = getActiveLine();
  if (!line) return;
  const now = new Date().toISOString();
  const tab = {
    id: generateId(),
    title: isFirst ? 'Crea tu primera pestaña' : (title || ''),
    description: '',
    color: PRESET_COLORS[0],
    createdBy: currentUser,
    createdAt: now,
    modifiedBy: currentUser,
    modifiedAt: now,
  };
  line.tabs.splice(index, 0, tab);
  saveLines();
  renderTabs();
  return tab;
}

// ══════════ MAIN LINE CLICK (add marker) ══════════
function setupMainLineClick() {
  currentWorkspace.mainLine.addEventListener('click', (e) => {
    // Skip the marker flash when it's the 2nd click of a double-click
    if (e.detail > 1) return;
    const rect = currentWorkspace.stage.getBoundingClientRect();
    const clickX = e.clientX - rect.left + currentWorkspace.body.scrollLeft;
    showAddMarker(clickX);
  });

  // Double-click on the main line inserts a tab right there, shifting others
  currentWorkspace.mainLine.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = currentWorkspace.stage.getBoundingClientRect();
    const clickX = e.clientX - rect.left + currentWorkspace.body.scrollLeft;
    insertTabAtPosition(clickX);
  });
}

function showAddMarker(clickX) {
  removeMarker();
  const marker = document.createElement('div');
  marker.className = 'add-marker';
  marker.style.left = clickX + 'px';
  marker.style.top = '50%';
  marker.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  currentWorkspace.stage.appendChild(marker);
  markerActive = true;

  marker.addEventListener('click', (e) => {
    e.stopPropagation();
    insertTabAtPosition(clickX);
  });
}

function removeMarker() {
  if (!currentWorkspace) return;
  const m = currentWorkspace.stage.querySelector('.add-marker');
  if (m) m.remove();
  markerActive = false;
}

function insertTabAtPosition(clickX) {
  const line = getActiveLine();
  if (!line) return;
  const tabs = line.tabs || [];
  const spacing = 260;
  let index = 0;
  for (let i = 0; i < tabs.length; i++) {
    const centerX = 60 + i * spacing;
    if (clickX > centerX) index = i + 1;
  }
  pushUndo();
  recordHistory(line, { type: 'crear_pestana', detail: `Pestaña insertada en posición ${index + 1}` });
  const tab = addTabAt(index, '', false);
  removeMarker();
  if (tab) openTabEditor(tab);
  toast('Pestaña agregada. Editala con doble clic.', 'success');
}

// ══════════ DRAG TO REORDER ══════════
function setupDragDrop() {
  const body = currentWorkspace.body;
  body.addEventListener('mousemove', (e) => { if (draggingState) moveDrag(e.clientX); });
  body.addEventListener('touchmove', (e) => { if (draggingState) { e.preventDefault(); moveDrag(e.touches[0].clientX); } }, { passive: false });
  body.addEventListener('mouseup', endDrag);
  body.addEventListener('touchend', endDrag);
  body.addEventListener('mouseleave', endDrag);
}

function startDrag(e, tabId) {
  e.preventDefault();
  e.stopPropagation();
  didDrag = false;
  draggingState = { tabId, startX: (e.clientX || e.touches[0].clientX) };
}

function moveDrag(clientX) {
  const line = getActiveLine();
  if (!line) return;
  const rect = currentWorkspace.stage.getBoundingClientRect();
  const posX = clientX - rect.left + currentWorkspace.body.scrollLeft;
  if (!didDrag && Math.abs(clientX - draggingState.startX) > 8) {
    didDrag = true;
    pushUndo();
    recordHistory(line, { type: 'reordenar', detail: 'Pestañas reordenadas' });
  }
  const spacing = 260;
  const tabs = line.tabs;
  const currentIndex = tabs.findIndex(t => t.id === draggingState.tabId);
  if (currentIndex === -1) return;

  let targetIndex = Math.round((posX - 60) / spacing);
  targetIndex = Math.max(0, Math.min(tabs.length - 1, targetIndex));

  if (targetIndex !== currentIndex) {
    const [moved] = tabs.splice(currentIndex, 1);
    tabs.splice(targetIndex, 0, moved);
    saveLines();
    renderTabs();
  }
}

function endDrag() {
  draggingState = null;
  setTimeout(() => { if (!draggingState) didDrag = false; }, 400);
}

// ══════════ BODY SCROLL SYNC ══════════
function setupBodyScroll() {
  currentWorkspace.body.addEventListener('scroll', updateScrollbar);

  let draggingThumb = false;
  const thumb = currentWorkspace.scrollbarThumb;
  const bar = currentWorkspace.scrollbar;

  thumb.addEventListener('mousedown', (e) => { draggingThumb = true; e.preventDefault(); thumb.classList.add('dragging'); });
  document.addEventListener('mousemove', (e) => {
    if (!draggingThumb) return;
    const barRect = bar.getBoundingClientRect();
    const ratio = (e.clientX - barRect.left) / barRect.width;
    const maxScroll = currentWorkspace.body.scrollWidth - currentWorkspace.body.clientWidth;
    currentWorkspace.body.scrollLeft = ratio * maxScroll;
  });
  document.addEventListener('mouseup', () => { if (draggingThumb) { draggingThumb = false; thumb.classList.remove('dragging'); } });
  bar.addEventListener('click', (e) => {
    const barRect = bar.getBoundingClientRect();
    const ratio = (e.clientX - barRect.left) / barRect.width;
    const maxScroll = currentWorkspace.body.scrollWidth - currentWorkspace.body.clientWidth;
    currentWorkspace.body.scrollLeft = ratio * maxScroll;
  });
}

function updateScrollbar() {
  if (!currentWorkspace) return;
  const body = currentWorkspace.body;
  const maxScroll = body.scrollWidth - body.clientWidth;
  if (maxScroll <= 0) {
    currentWorkspace.scrollbarThumb.style.width = '100%';
    currentWorkspace.scrollbarThumb.style.left = '0';
    return;
  }
  const ratio = body.clientWidth / body.scrollWidth;
  currentWorkspace.scrollbarThumb.style.width = Math.max(30, ratio * 100) + '%';
  currentWorkspace.scrollbarThumb.style.left = (body.scrollLeft / maxScroll) * (100 - Math.max(30, ratio * 100)) + '%';
}

// ══════════ DRAWER ══════════
let drawerDragId = null;

function renderDrawer() {
  if (!currentWorkspace) return;
  const list = currentWorkspace.drawerList;
  list.innerHTML = '';
  const tabs = (getActiveLine().tabs || []);
  tabs.forEach((tab, idx) => {
    const li = document.createElement('li');
    li.style.borderLeftColor = tab.color;
    li.draggable = true;
    li.dataset.drawerId = tab.id;
    li.innerHTML = `
      <span class="drawer-grip">≡</span>
      <span class="drawer-title">${escapeHtml(tab.title || 'Sin título')}</span>
      <span class="drawer-index">${idx + 1}</span>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.drawer-grip')) return;
      openTabEditor(tab);
    });
    li.addEventListener('dragstart', (e) => {
      drawerDragId = tab.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tab.id); } catch (_) {}
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      drawerDragId = null;
    });
    li.addEventListener('dragover', (e) => { e.preventDefault(); });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromId = drawerDragId || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || tab.id;
      const toId = tab.id;
      if (fromId && fromId !== toId) moveTabInList(fromId, toId);
    });
    list.appendChild(li);
  });
}

function moveTabInList(fromId, toId) {
  const line = getActiveLine();
  if (!line) return;
  const fromIdx = line.tabs.findIndex(t => t.id === fromId);
  const toIdx = line.tabs.findIndex(t => t.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  pushUndo();
  const [moved] = line.tabs.splice(fromIdx, 1);
  line.tabs.splice(toIdx, 0, moved);
  saveLines();
  renderTabs();
  renderDrawer();
}

function closeDrawer() {
  currentWorkspace.drawer.classList.remove('open');
  currentWorkspace.drawerOverlay.classList.remove('visible');
}

function scrollToTab(tabId) {
  const node = currentWorkspace.stage.querySelector(`.tab-node[data-tab-id="${tabId}"]`);
  if (node) {
    const target = node.offsetLeft - currentWorkspace.body.clientWidth / 2 + 110;
    currentWorkspace.body.scrollTo({ left: target, behavior: 'smooth' });
  }
}

// ══════════ TAB EDITOR ══════════
let editingTabId = null;

function buildPresetSwatches() {
  // Build swatches in the tab editor (affects tab color)
  const tabContainer = document.querySelector('#tab-modal .preset-colors');
  if (tabContainer && !tabContainer.dataset.built) {
    tabContainer.dataset.built = '1';
    PRESET_COLORS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'present-color-swatch';
      sw.style.background = c;
      sw.dataset.color = c;
      sw.addEventListener('click', () => selectPreset(c));
      tabContainer.appendChild(sw);
    });
  }
  // Build swatches in the line editor (affects project background)
  const bgContainer = document.querySelector('#line-modal .preset-colors');
  if (bgContainer && !bgContainer.dataset.built) {
    bgContainer.dataset.built = '1';
    BG_PRESETS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'present-color-swatch';
      sw.style.background = c;
      sw.dataset.color = c;
      sw.addEventListener('click', () => selectBgPreset(c));
      bgContainer.appendChild(sw);
    });
  }
}

// Background presets are the flat solid colors plus white/dark extras
const BG_PRESETS = ['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#10b981', '#0f172a'];

function selectPreset(hex) {
  $$('#tab-modal .present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === hex));
  setTabColor(hex);
}

function selectBgPreset(hex) {
  $$('#line-modal .present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === hex));
  setBgColor(hex);
}

function setTabColor(hex) {
  $('#tab-color').value = hex;
  const { r, g, b } = hexToRgb(hex);
  $('#tab-r').value = r; $('#tab-r-val').textContent = r;
  $('#tab-g').value = g; $('#tab-g-val').textContent = g;
  $('#tab-b').value = b; $('#tab-b-val').textContent = b;
}

function setupTabModal() {
  buildPresetSwatches();

  const sync = () => {
    const hex = rgbToHex(parseInt($('#tab-r').value), parseInt($('#tab-g').value), parseInt($('#tab-b').value));
    $('#tab-r-val').textContent = $('#tab-r').value;
    $('#tab-g-val').textContent = $('#tab-g').value;
    $('#tab-b-val').textContent = $('#tab-b').value;
    $('#tab-color').value = hex;
    $$('.present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === hex));
  };

  $('#tab-r').addEventListener('input', sync);
  $('#tab-g').addEventListener('input', sync);
  $('#tab-b').addEventListener('input', sync);
  $('#tab-color').addEventListener('input', (e) => {
    const { r, g, b } = hexToRgb(e.target.value);
    $('#tab-r').value = r; $('#tab-r-val').textContent = r;
    $('#tab-g').value = g; $('#tab-g-val').textContent = g;
    $('#tab-b').value = b; $('#tab-b-val').textContent = b;
    $$('.present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === e.target.value));
  });

  $('#tab-close').addEventListener('click', () => { $('#tab-modal').style.display = 'none'; editingTabId = null; });
  $('#tab-cancel').addEventListener('click', () => { $('#tab-modal').style.display = 'none'; editingTabId = null; });
  $('#tab-save-btn').addEventListener('click', saveTab);
  $('#tab-delete-in-modal').addEventListener('click', deleteTab);
}

function openTabEditor(tab) {
  editingTabId = tab.id;
  $('#tab-modal-title').textContent = 'Editar Pestaña';
  $('#tab-title').value = tab.title || '';
  $('#tab-desc').value = tab.description || '';
  $('#tab-delete-in-modal').style.display = '';
  setTabColor(tab.color || '#6366f1');
  $$('.present-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === (tab.color || '#6366f1')));

  $('#tab-audit').style.display = '';
  $('#tab-created-by').textContent = tab.createdBy || '—';
  $('#tab-created-at').textContent = formatDate(tab.createdAt);
  $('#tab-modified-by').textContent = tab.modifiedBy || '—';
  $('#tab-modified-at').textContent = formatDate(tab.modifiedAt);

  $('#tab-modal').style.display = '';
  $('#tab-title').focus();
}

function saveTab() {
  const line = getActiveLine();
  if (!line) return;

  const title = $('#tab-title').value.trim();
  const description = $('#tab-desc').value.trim();
  const color = rgbToHex(parseInt($('#tab-r').value), parseInt($('#tab-g').value), parseInt($('#tab-b').value));
  const now = new Date().toISOString();

  if (editingTabId) {
    const tab = line.tabs.find(t => t.id === editingTabId);
    if (tab) {
      pushUndo();
      recordHistory(line, { type: 'editar_pestana', detail: `Pestaña "${tab.title || 'Sin título'}" editada` });
      tab.title = title;
      tab.description = description;
      tab.color = color;
      tab.modifiedBy = currentUser;
      tab.modifiedAt = now;
      saveLines();
      toast('Pestaña actualizada', 'success');
    }
  }

  $('#tab-modal').style.display = 'none';
  editingTabId = null;
  renderTabs();
}

function deleteTab() {
  if (!editingTabId) return;
  if (!confirm('¿Eliminar esta pestaña?')) return;
  const line = getActiveLine();
  if (!line) return;
  pushUndo();
  const t = line.tabs.find(x => x.id === editingTabId);
  recordHistory(line, { type: 'eliminar_pestana', detail: `Pestaña "${t ? t.title : ''}" eliminada` });
  line.tabs = line.tabs.filter(t => t.id !== editingTabId);
  saveLines();
  $('#tab-modal').style.display = 'none';
  editingTabId = null;
  renderTabs();
  toast('Pestaña eliminada', 'success');
}

// ══════════ SAVE LOCAL FILE ══════════
function saveLocalFile() {
  const line = getActiveLine();
  if (!line) return;
  saveLines();
  const payload = { app: 'timeline-studio', version: 1, lines, users, exportedAt: new Date().toISOString(), exportedBy: currentUser };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `timeline-${line.title.replace(/[^a-z0-9]+/gi, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Línea de tiempo guardada en archivo local', 'success');
}

// ══════════ HISTORY MODAL ══════════
function setupHistoryModal() {
  $('#history-close').addEventListener('click', () => { $('#history-modal').style.display = 'none'; });
}
function openHistory() {
  const line = getActiveLine();
  const list = $('#history-list');
  const empty = $('#history-empty');
  list.innerHTML = '';
  const history = line ? (line.history || []) : [];
  if (history.length === 0) {
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    history.slice().reverse().forEach((h) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="history-dot" style="background:${line.color || '#6366f1'}"></div>
        <div class="history-info">
          <div class="history-action">${escapeHtml(h.type || 'Cambio')}</div>
          <div class="history-detail">${escapeHtml(h.detail || '')}</div>
        </div>
        <div class="history-meta">
          <div class="history-user">${escapeHtml(h.user || '—')}</div>
          <div class="history-time">${formatTimeOnly(h.time)}</div>
        </div>
      `;
      list.appendChild(item);
    });
  }
  $('#history-modal').style.display = '';
}

// ══════════ HELP MODAL ══════════
function setupHelp() {
  const items = [
    ['👤', 'Usuarios', 'Elegí o creá tu usuario. Tu nombre firma cada pestaña que coloques y aparece en el historial.'],
    ['➕', 'Crear línea', 'En el menú principal, "Crear nueva línea de tiempo". Le ponés título y color de la barra.'],
    ['🖱️', 'Agregar pestañas', 'Hacé clic en la línea principal y aparecerá un círculo con +. Clic en el + para insertar una pestaña ahí. O usá el botón "Nueva" de la barra de herramientas inferior (al final).'],
    ['📝', 'Editar pestaña', 'Doble clic sobre una pestaña. Podés poner título, descripción y elegir entre 12 colores o armar el tuyo con RGB.'],
    ['👁️', 'Ver descripción', 'Un solo clic sobre una pestaña despliega su descripción completa.'],
    ['↔️', 'Reordenar', 'Arrastrá una pestaña tomándola de su patita (puntito) para cambiar su posición.'],
    ['🎨', 'Editar proyecto', 'En la barra inferior, botón "Editar". Cambia el color de fondo, el color de la línea, el nombre, o eliminá el proyecto.'],
    ['↩️', 'Deshacer / Rehacer', 'Botones "Deshacer" y "Rehacer" en la barra inferior retroceden o rehacen un cambio a la vez.'],
    ['💾', 'Guardar', 'El botón "Guardar" guarda la línea en el dispositivo. Si configuraste Sincronizar con GitHub, lo sube a tu repositorio para verlo en otros dispositivos.'],
    ['🔄', 'Sincronizar con GitHub', 'Con el botón de sincronizar configurás tu repositorio y tu token. "Guardar" sube el progreso y al abrir la app se baja automáticamente lo más reciente de cualquier dispositivo.'],
    ['🕘', 'Historial', 'El botón "Historial" muestra todos los cambios hechos en esa línea: quién, qué y cuándo.'],
    ['☰', 'Menú de pestañas', 'El botón de tres rayitas lista todas las pestañas. Clic te lleva a ella, doble clic la edita.'],
    ['📜', 'Desplazarte', 'Usá la barra de scroll arriba de todo para recorrer la línea.'],
    ['🌙', 'Modo oscuro', 'Botón de luna/sol en el menú principal y al iniciar sesión. Se guarda tu preferencia.'],
  ];
  const body = $('#help-body');
  body.innerHTML = items.map(([icon, title, desc]) => `
    <div class="help-item"><span class="help-icon">${icon}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(desc)}</p></div></div>
  `).join('');

  $('#help-btn').addEventListener('click', () => { $('#help-modal').style.display = ''; });
  $('#help-close').addEventListener('click', () => { $('#help-modal').style.display = 'none'; });
}
function openHelp() { $('#help-modal').style.display = ''; }

// ══════════ GLOBAL KEYBOARD ══════════
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#tab-modal').style.display = 'none';
      $('#line-modal').style.display = 'none';
      $('#help-modal').style.display = 'none';
      $('#history-modal').style.display = 'none';
      $('#sync-modal').style.display = 'none';
      $('#user-menu-modal').style.display = 'none';
      if (currentWorkspace) closeDrawer();
      removeMarker();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSaveAll(); }
  });
}

// ══════════ GLOBAL MARKER DISMISS ══════════
function setupMarkerDismiss() {
  if (window.__markerDismissBound) return;
  window.__markerDismissBound = true;
  document.addEventListener('click', (e) => {
    if (!markerActive) return;
    if (!e.target.closest('.add-marker')) removeMarker();
  });
}

// ══════════ INIT ══════════
function init() {
  loadLocal();
  setupTheme();
  setupLogin();
  setupUserMenu();
  setupMainMenuActions();
  setupLineModal();
  setupTabModal();
  setupHistoryModal();
  setupHelp();
  setupKeyboard();
  setupMarkerDismiss();
  setupSync();

  if (currentUser && users.find(u => u.name === currentUser)) {
    showMainMenu();
    if (syncApi) {
      pullProgress().then((hasData) => {
        if (hasData) {
          if (activeLineId && currentWorkspace) renderTabs();
        }
        connectRealtime();
      });
    }
  } else {
    currentUser = null;
    localStorage.removeItem(STORAGE_SESSION);
    showLogin();
    // Even without a session, connect realtime so changes flow in when logging in later
    if (syncApi) pullProgress();
  }
}

init();
