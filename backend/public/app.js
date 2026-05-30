// ============================================================
//  State
// ============================================================
let token = localStorage.getItem('admin_token') || '';
let currentPage = 'dashboard';
let keysPage = 1;
let logsPage = 1;
let currentApp = null; // { id, name, owner_id, app_secret }
let allApps = [];

// App selection helpers
async function fetchApps() {
  var data = await api('GET', '/admin/apps');
  if (data && data.success) {
    allApps = data.apps || [];
  } else {
    allApps = [];
  }
  return allApps;
}

async function initAppSelection() {
  await fetchApps();
  // Se só existe 1 app, seleciona automaticamente
  if (allApps.length === 1) {
    currentApp = allApps[0];
  } else if (allApps.length > 1) {
    // Tenta restaurar do localStorage
    var savedId = localStorage.getItem('current_app_id');
    if (savedId) {
      for (var i = 0; i < allApps.length; i++) {
        if (allApps[i].id === savedId) { currentApp = allApps[i]; break; }
      }
    }
    // Se nao restaurou e tem o default, seleciona
    if (!currentApp) {
      for (var j = 0; j < allApps.length; j++) {
        if (allApps[j].id === '00000000-0000-0000-0000-000000000001') { currentApp = allApps[j]; break; }
      }
    }
    // Se ainda nao, seleciona o primeiro
    if (!currentApp && allApps.length > 0) {
      currentApp = allApps[0];
    }
  }
  renderAppSelector();
}

function selectApp(app) {
  currentApp = app;
  if (app) localStorage.setItem('current_app_id', app.id);
  else localStorage.removeItem('current_app_id');

  // Se saiu do app (selecionou "Todos"), volta pro dashboard
  if (!app && currentPage !== 'apps' && currentPage !== 'dashboard') {
    currentPage = 'dashboard';
  }

  renderAppSelector();

  // Recarrega a pagina atual com o novo app
  if (currentPage === 'dashboard') loadDashboard();
  else if (currentPage === 'keys') loadKeys(1);
  else if (currentPage === 'logs') loadLogs(1);
}

function renderAppSelector() {
  var el = document.getElementById('appSelector');
  if (!el) return;
  var label = currentApp ? esc(currentApp.name) : 'Todos os Apps';
  var items = '';
  // Opcao "Todos"
  items += '<div class="app-opt' + (currentApp === null ? ' sel' : '') + '" data-app-id=""><span>Todos os Apps</span></div>';
  // Lista de apps
  for (var i = 0; i < allApps.length; i++) {
    var isSel = currentApp && allApps[i].id === currentApp.id;
    items += '<div class="app-opt' + (isSel ? ' sel' : '') + '" data-app-id="' + allApps[i].id + '"><span>' + esc(allApps[i].name) + '</span><small>' + (allApps[i].key_count || 0) + ' keys</small></div>';
  }
  el.innerHTML = '<div class="app-trigger" id="appSelTrigger">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
    '<span>' + label + '</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</div>' +
    '<div class="app-dropdown" id="appSelDrop">' + items + '</div>';
  // Toggle dropdown
  document.getElementById('appSelTrigger').addEventListener('click', function (e) {
    e.stopPropagation();
    el.classList.toggle('open');
  });
  // Fechar ao clicar fora
  document.addEventListener('click', function () { el.classList.remove('open'); });
  // Click nos itens
  var opts = el.querySelectorAll('.app-opt');
  for (var j = 0; j < opts.length; j++) {
    opts[j].addEventListener('click', function (e) {
      e.stopPropagation();
      var appId = this.getAttribute('data-app-id');
      if (appId === '') { selectApp(null); }
      else {
        for (var k = 0; k < allApps.length; k++) {
          if (allApps[k].id === appId) { selectApp(allApps[k]); break; }
        }
      }
      el.classList.remove('open');
    });
  }
}

// URL do backend - detecta automaticamente
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '' // Usa o mesmo servidor quando local
  : 'https://pedrin-xits-panel.onrender.com';

// ============================================================
//  API Helper
// ============================================================
async function api(method, url, body) {
  var fullUrl = API_BASE + url;
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  try {
    var res = await fetch(fullUrl, opts);
    var data = await res.json();
    if (res.status === 401) {
      token = '';
      localStorage.removeItem('admin_token');
      showLogin();
      showToast('Sessão expirada.', 'error');
      return null;
    }
    return data;
  } catch (e) {
    showToast('Erro de conexão.', 'error');
    return null;
  }
}

// ============================================================
//  Toast
// ============================================================
function showToast(msg, type) {
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');

  var icons = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  var titles = { success: 'Sucesso', error: 'Erro', info: 'Aviso' };

  toast.innerHTML =
    '<div class="toast-icon">' + (icons[type] || icons.info) + '</div>' +
    '<div class="toast-body"><span class="toast-title">' + (titles[type] || 'Aviso') + '</span><span class="toast-msg">' + esc(msg) + '</span></div>' +
    '<button class="toast-ok">OK</button>';

  var okBtn = toast.querySelector('.toast-ok');
  okBtn.addEventListener('click', function () { removeToast(toast); });

  container.appendChild(toast);
  toast._timer = setTimeout(function () { removeToast(toast); }, 5000);
}

function removeToast(toast) {
  if (!toast || toast._dismissed) return;
  toast._dismissed = true;
  if (toast._timer) clearTimeout(toast._timer);
  toast.classList.add('toast-out');
  setTimeout(function () { toast.remove(); }, 300);
}

// ============================================================
//  Helpers
// ============================================================
function esc(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function fmtDate(dt) {
  if (!dt) return '-';
  try {
    var d = new Date(dt);
    if (isNaN(d.getTime())) return dt;
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return dt; }
}

function logClass(action) {
  if (!action) return 'info';
  var a = action.toLowerCase();
  if (a.indexOf('ok') >= 0 || a.indexOf('created') >= 0 || a.indexOf('activated') >= 0 || a.indexOf('extended') >= 0 || a.indexOf('reset') >= 0 || (a.indexOf('login') >= 0 && a.indexOf('fail') < 0) || a.indexOf('unpaused') >= 0) return 'ok';
  if (a.indexOf('fail') >= 0 || a.indexOf('deleted') >= 0 || a.indexOf('banned') >= 0 || a.indexOf('expired') >= 0 || a.indexOf('mismatch') >= 0) return 'fail';
  if (a.indexOf('updated') >= 0 || a.indexOf('cleared') >= 0 || a.indexOf('paused') >= 0) return 'warn';
  return 'info';
}

function copyKey(key) {
  navigator.clipboard.writeText(key).then(function () {
    showToast('Key copiada!', 'success');
  }).catch(function () {
    var t = document.createElement('textarea');
    t.value = key;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    showToast('Key copiada!', 'success');
  });
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

function showConfirm(title, message, onConfirm) {
  openModal(
    '<h3>' + esc(title) + '</h3>' +
    '<p style="color:var(--text-secondary);font-size:14px;line-height:1.6;margin-bottom:8px">' + esc(message) + '</p>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-ghost" id="confirmCancelBtn">Cancelar</button>' +
    '<button class="btn btn-danger" id="confirmOkBtn">Confirmar</button>' +
    '</div>'
  );
  setTimeout(function () {
    document.getElementById('confirmCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('confirmOkBtn').addEventListener('click', function () {
      closeModal();
      onConfirm();
    });
  }, 50);
}

function pagination(current, total, limit, callback) {
  var totalPages = Math.ceil(total / limit) || 1;
  var html = '<span>Página ' + current + ' de ' + totalPages + ' (' + total + ' itens)</span><div style="display:flex;gap:6px">';
  if (current > 1) html += '<button class="btn btn-ghost btn-sm" onclick="' + callback + '(' + (current - 1) + ')">‹ Anterior</button>';
  if (current < totalPages) html += '<button class="btn btn-ghost btn-sm" onclick="' + callback + '(' + (current + 1) + ')">Próxima ›</button>';
  html += '</div>';
  return html;
}

// ============================================================
//  Sidebar Toggle — Desktop collapses, Mobile slides overlay
// ============================================================
function isMobile() {
  return window.innerWidth <= 768;
}

function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (isMobile()) {
    var overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  } else {
    sidebar.classList.toggle('collapsed');
    // Persist collapsed state
    if (sidebar.classList.contains('collapsed')) {
      localStorage.setItem('sidebar_collapsed', '1');
    } else {
      localStorage.removeItem('sidebar_collapsed');
    }
  }
}

function openMobileSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.add('open');
  overlay.classList.add('open');
}

function closeMobileSidebar() {
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

// ============================================================
//  Auth
// ============================================================
function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
}

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  // Restore sidebar collapsed state
  if (!isMobile() && localStorage.getItem('sidebar_collapsed') === '1') {
    document.getElementById('sidebar').classList.add('collapsed');
  }
  initAppSelection().then(function () {
    // Se so existe 1 app, vai direto pro dashboard
    if (allApps.length <= 1) {
      if (allApps.length === 1) selectApp(allApps[0]);
      else selectApp(null);
      navigateTo('dashboard');
    } else {
      // Mais de 1 app: mostra tela de escolha
      showAppPicker();
    }
  });
}

function showAppPicker() {
  var c = document.getElementById('contentArea');
  var html = '<div class="app-picker-wrap">';
  html += '<div class="app-picker-header">';
  html += '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent)"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
  html += '<h2>Escolha um Aplicativo</h2>';
  html += '<p style="color:var(--text-secondary);margin-top:8px">Selecione o aplicativo para gerenciar</p>';
  html += '</div>';
  html += '<div class="app-picker-grid">';
  for (var i = 0; i < allApps.length; i++) {
    var a = allApps[i];
    html += '<div class="app-picker-card" onclick="selectApp(allApps[' + i + ']); navigateTo(\'dashboard\');">';
    html += '<div class="app-picker-icon">';
    html += '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    html += '</div>';
    html += '<div class="app-picker-name">' + esc(a.name) + '</div>';
    html += '<div class="app-picker-count">' + (a.key_count || 0) + ' keys</div>';
    html += '</div>';
  }
  html += '</div>'; // grid
  html += '</div>'; // wrap
  c.innerHTML = html;
}

async function doLogin() {
  var user = document.getElementById('loginUser').value.trim();
  var pass = document.getElementById('loginPass').value;
  var errEl = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var btnText = btn.querySelector('.btn-text');
  var btnLoader = btn.querySelector('.btn-loader');

  if (!user || !pass) {
    errEl.textContent = 'Preencha todos os campos.';
    errEl.style.display = 'block';
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
    return;
  }

  btnText.style.display = 'none';
  btnLoader.style.display = 'inline-flex';
  btn.disabled = true;
  errEl.style.display = 'none';

  var data = await api('POST', '/admin/login', { username: user, password: pass });

  btnText.style.display = 'inline';
  btnLoader.style.display = 'none';
  btn.disabled = false;

  if (data && data.success) {
    token = data.token;
    localStorage.setItem('admin_token', token);
    showApp();
    showToast('Bem-vindo!', 'success');
  } else {
    errEl.textContent = (data && data.message) || 'Credenciais inválidas.';
    errEl.style.display = 'block';
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
  }
}

function doLogout() {
  token = '';
  localStorage.removeItem('admin_token');
  showLogin();
  showToast('Sessão encerrada.', 'info');
}

document.getElementById('loginPass').addEventListener('keypress', function (e) { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginUser').addEventListener('keypress', function (e) { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });

// Event listeners para elementos que tinham onclick inline
document.getElementById('loginBtn').addEventListener('click', function () { doLogin(); });
document.getElementById('logoutBtn').addEventListener('click', function () { doLogout(); });
document.getElementById('sidebarToggle').addEventListener('click', function () { toggleSidebar(); });
document.getElementById('mobileHamburger').addEventListener('click', function () { toggleSidebar(); });

// Navegação da sidebar via data-nav
var navItems = document.querySelectorAll('[data-nav]');
for (var i = 0; i < navItems.length; i++) {
  (function (item) {
    item.addEventListener('click', function () {
      navigateTo(item.getAttribute('data-nav'));
    });
  })(navItems[i]);
}

// Modal close on overlay click
document.getElementById('modalOverlay').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

// Sidebar overlay close
document.getElementById('sidebarOverlay').addEventListener('click', function () {
  closeMobileSidebar();
});

// Botão de importar keys - evento registrado via onclick inline no render

function showNoAppScreen() {
  var c = document.getElementById('contentArea');
  c.innerHTML =
    '<div class="app-picker-wrap">' +
    '<div class="app-picker-header">' +
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--accent)"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
    '<h2>Nenhum Aplicativo</h2>' +
    '<p style="color:var(--text-secondary);margin-top:8px">Crie um aplicativo para começar</p>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="showCreateAppModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Criar Primeiro App</button>' +
    '</div>';
}

// ============================================================
//  Navigation
// ============================================================
var _navLock = false;
function navigateTo(page) {
  if (_navLock) return;
  _navLock = true;
  setTimeout(function () { _navLock = false; }, 500);
  currentPage = page;
  var items = document.querySelectorAll('.nav-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].getAttribute('data-nav') === page);
  }

  if (isMobile()) {
    closeMobileSidebar();
  }

  var content = document.getElementById('contentArea');
  content.style.animation = 'none';
  content.offsetHeight;
  content.style.animation = '';

  // Se não tem app selecionado e tem mais de 1, mostra picker (exceto pra apps)
  if (!currentApp && allApps.length > 1 && page !== 'apps') {
    if (page !== 'dashboard') currentPage = page; // salva pagina desejada
    showAppPicker();
    return;
  }

  // Se nenhum app existe ainda e nao e tela de apps, mostra picker
  if (!currentApp && allApps.length === 0 && page !== 'apps') {
    currentPage = page;
    showNoAppScreen();
    return;
  }

  if (page === 'dashboard') loadDashboard();
  else if (page === 'keys') loadKeys(1);
  else if (page === 'logs') loadLogs(1);
  else if (page === 'apps') loadApps();
}

// ============================================================
//  APPS - Gerenciamento de Aplicativos
// ============================================================
async function loadApps() {
  var c = document.getElementById('contentArea');
  c.innerHTML = '<div class="page-header"><h2>Aplicativos</h2></div><div style="display:flex;align-items:center;justify-content:center;padding:80px;color:var(--text-muted)"><div class="spinner"></div></div>';

  var data = await api('GET', '/admin/apps');
  if (!data || !data.success) {
    c.innerHTML = '<div class="page-header"><h2>Aplicativos</h2></div><div style="text-align:center;padding:60px;color:var(--text-muted)"><p>Não foi possível carregar os aplicativos.</p><button class="btn btn-ghost" onclick="loadApps()">Tentar novamente</button></div>';
    return;
  }

  var apps = data.apps || [];

  var rows = '';
  if (apps.length === 0) {
    rows = '<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--text-muted)">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="margin:0 auto 12px;display:block;opacity:.4"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' +
      'Nenhum aplicativo cadastrado</td></tr>';
  } else {
    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      var isDefault = a.id === '00000000-0000-0000-0000-000000000001';
      var deleteBtn = isDefault ?
        '<span style="color:var(--text-muted);font-size:12px">Padrão</span>' :
        '<button class="btn btn-ghost btn-sm" onclick="deleteApp(\'' + a.id + '\',\'' + esc(a.name.replace(/'/g, "\\'")) + '\')" title="Deletar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>';
      rows += '<tr>' +
        '<td><strong>' + esc(a.name) + '</strong></td>' +
        '<td><code style="font-size:11px;background:rgba(255,255,255,0.04);padding:3px 8px;border-radius:4px">' + esc(a.owner_id) + '</code></td>' +
        '<td><code style="font-size:11px;background:rgba(255,255,255,0.04);padding:3px 8px;border-radius:4px;word-break:break-all">' + esc(a.app_secret) + '</code></td>' +
        '<td>' + (a.key_count || 0) + '</td>' +
        '<td>' + fmtDate(a.created_at) + '</td>' +
        '<td><div class="action-btns">' + deleteBtn + '</div></td>' +
        '</tr>';
    }
  }

  c.innerHTML = '<div class="page-header"><h2>Aplicativos</h2><div class="actions">' +
    '<button class="btn btn-primary" onclick="showCreateAppModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Criar App</button></div></div>' +
    '<div class="table-container">' +
    '<div style="overflow-x:auto"><table><thead><tr><th>Nome</th><th>Owner ID</th><th>Secret</th><th>Keys</th><th>Criado</th><th>Ações</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';
}

function showCreateAppModal() {
  openModal(
    '<h3>Criar Aplicativo</h3>' +
    '<div class="form-group"><label>Nome do Aplicativo</label><input type="text" id="appNameInput" placeholder="Ex: Meu App"></div>' +
    '<div class="form-group"><label>Owner ID <span style="color:var(--text-muted);font-size:12px">(opcional, gerado automaticamente)</span></label><input type="text" id="appOwnerInput" placeholder="UUID ou vazio para auto"></div>' +
    '<div id="appCreateResult"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="appCancelBtn">Cancelar</button><button class="btn btn-primary" id="appCreateBtn">Criar</button></div>'
  );
  setTimeout(function () {
    document.getElementById('appCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('appCreateBtn').addEventListener('click', function () { doCreateApp(); });
  }, 50);
}

async function doCreateApp() {
  var name = document.getElementById('appNameInput').value.trim();
  var ownerId = document.getElementById('appOwnerInput').value.trim();

  if (!name) { showToast('Nome é obrigatório.', 'error'); return; }

  var body = { name: name };
  if (ownerId) body.owner_id = ownerId;

  var data = await api('POST', '/admin/apps', body);
  if (!data || !data.success) {
    showToast(data ? data.message : 'Erro ao criar.', 'error');
    return;
  }

  closeModal();
  showToast('Aplicativo criado com sucesso!', 'success');
  await fetchApps();
  if (!currentApp) selectApp(data.app);
  renderAppSelector();
  loadApps();
}

async function deleteApp(id, name) {
  showConfirm('Deletar Aplicativo', 'Deseja deletar "' + name + '"? As keys deste app serão desassociadas.', function () {
    api('DELETE', '/admin/apps/' + id).then(async function (data) {
      if (data && data.success) {
        showToast(data.message, 'success');
        await fetchApps();
        // Se deletou o app selecionado, troca pro primeiro disponível
        if (currentApp && currentApp.id === id) {
          currentApp = allApps.length > 0 ? allApps[0] : null;
        }
        renderAppSelector();
        loadApps();
      } else {
        showToast(data ? data.message : 'Erro ao deletar.', 'error');
      }
    });
  });
}

// ============================================================
//  DASHBOARD
// ============================================================
async function loadDashboard() {
  var c = document.getElementById('contentArea');
  var appLabel = currentApp ? ' — ' + esc(currentApp.name) : '';
  c.innerHTML = '<div class="page-header"><h2>Dashboard' + appLabel + '</h2></div><div style="display:flex;align-items:center;justify-content:center;padding:80px;color:var(--text-muted)"><div class="spinner"></div></div>';

  // Busca keys filtradas por app (se tiver selecionado) para stats
  var keysUrl = '/admin/keys?page=1&limit=9999';
  if (currentApp) keysUrl += '&app_id=' + currentApp.id;
  var keysData = await api('GET', keysUrl);

  // Busca logs recentes
  var data = await api('GET', '/admin/dashboard');
  if (!data || !data.success) {
    c.innerHTML = '<div class="page-header"><h2>Dashboard' + appLabel + '</h2></div><div style="text-align:center;padding:60px;color:var(--text-muted)"><p>Não foi possível carregar o dashboard.</p><button class="btn btn-ghost" onclick="loadDashboard()">Tentar novamente</button></div>';
    return;
  }

  // Calcula stats por app localmente
  var s = { total_keys: 0, active_keys: 0, unused_keys: 0, expired_keys: 0, banned_keys: 0, paused_keys: 0 };
  if (keysData && keysData.success && keysData.keys) {
    for (var k = 0; k < keysData.keys.length; k++) {
      var kr = keysData.keys[k];
      s.total_keys++;
      if (kr.status === 'active' && !kr.paused) s.active_keys++;
      else if (kr.status === 'unused') s.unused_keys++;
      else if (kr.status === 'expired') s.expired_keys++;
      else if (kr.status === 'banned') s.banned_keys++;
      if (kr.paused) s.paused_keys++;
    }
  }

  var statIcons = {
    total: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    active: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    unused: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    expired: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    banned: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    paused: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    apps: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
  };

  function statCard(icon, label, value, cls) {
    return '<div class="stat-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
      '<span class="label">' + label + '</span>' +
      '<span style="color:var(--text-muted);opacity:.5">' + icon + '</span>' +
      '</div>' +
      '<div class="value ' + cls + '">' + value + '</div>' +
      '</div>';
  }

  var logsHtml = '';
  if (data.recent_logs.length === 0) {
    logsHtml = '<div style="padding:40px;text-align:center;color:var(--text-muted)">Nenhum log recente</div>';
  } else {
    for (var i = 0; i < data.recent_logs.length; i++) {
      var l = data.recent_logs[i];
      logsHtml += '<div class="log-entry"><span class="log-time">' + fmtDate(l.created_at) + '</span><span class="log-action ' + logClass(l.action) + '">' + esc(l.action) + '</span><span class="log-details">' + esc(l.details) + '</span></div>';
    }
  }

  c.innerHTML = '<div class="page-header"><h2>Dashboard</h2><div class="actions"><button class="btn btn-ghost btn-sm" onclick="loadDashboard()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Atualizar</button></div></div>' +
    '<div class="stats-grid">' +
    statCard(statIcons.total, 'Total Keys', s.total_keys, 'total') +
    statCard(statIcons.active, 'Ativas', s.active_keys, 'active') +
    statCard(statIcons.unused, 'Não Usadas', s.unused_keys, 'unused') +
    statCard(statIcons.expired, 'Expiradas', s.expired_keys, 'expired') +
    statCard(statIcons.banned, 'Banidas', s.banned_keys, 'banned') +
    statCard(statIcons.paused, 'Pausadas', s.paused_keys, 'paused') +
    '</div>' +
    '<div class="table-container"><div class="table-toolbar"><span class="toolbar-label">Atividades Recentes</span></div><div style="max-height:400px;overflow-y:auto">' + logsHtml + '</div></div>';
}

// ============================================================
//  KEYS
// ============================================================
async function loadKeys(page) {
  if (page) keysPage = page;
  var c = document.getElementById('contentArea');
  var appLabel = currentApp ? ' — ' + esc(currentApp.name) : '';
  c.innerHTML = '<div class="page-header"><h2>Licenças' + appLabel + '</h2></div><div style="display:flex;align-items:center;justify-content:center;padding:80px;color:var(--text-muted)"><div class="spinner"></div></div>';

  var sf = (document.getElementById('keyStatusFilter') || {}).value || '';
  var search = (document.getElementById('keySearch') || {}).value || '';

  var url = '/admin/keys?page=' + keysPage + '&limit=25';
  if (currentApp) url += '&app_id=' + currentApp.id;
  else url += '&app_id=__none__'; // sem app = keys órfãs
  if (sf) url += '&status=' + sf;
  if (search) url += '&search=' + encodeURIComponent(search);

  var data = await api('GET', url);
  if (!data || !data.success) {
    c.innerHTML = '<div class="page-header"><h2>Licenças</h2></div><div style="text-align:center;padding:60px;color:var(--text-muted)"><p>Não foi possível carregar as licenças.</p><button class="btn btn-ghost" onclick="loadKeys(1)">Tentar novamente</button></div>';
    return;
  }

  var rows = '';

  if (data.keys.length === 0) {
    rows = '<tr><td colspan="8" style="text-align:center;padding:48px;color:var(--text-muted)">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="margin:0 auto 12px;display:block;opacity:.4"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
      'Nenhuma key encontrada</td></tr>';
  } else {
    for (var i = 0; i < data.keys.length; i++) {
      var k = data.keys[i];
      var hwid = k.hwid ? k.hwid.substring(0, 16) + '…' : '—';
      var statusBadge = k.paused ? 'paused' : k.status;
      var statusLabel = k.paused ? 'paused' : k.status;
      var durationLabel = k.is_lifetime ? 'LIFETIME' : k.duration_days + 'd';
      var btns = '';

      // Botão Reset HWID (sempre visível)
      btns += '<button class="btn btn-ghost btn-sm" onclick="resetHwid(\'' + k.id + '\')" title="Resetar HWID"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>';

      // Botão Estender (apenas para não lifetime)
      if (k.status === 'active' && !k.is_lifetime) btns += '<button class="btn btn-ghost btn-sm" onclick="showExtendModal(\'' + k.id + '\')" title="Estender"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';

      // Botão Pausar/Despausar individual (apenas para keys ativas ou pausadas)
      if (k.status === 'active' || k.paused) {
        if (k.paused) {
          btns += '<button class="btn btn-ghost btn-sm" onclick="togglePauseKey(\'' + k.id + '\')" title="Despausar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>';
        } else {
          btns += '<button class="btn btn-ghost btn-sm" onclick="togglePauseKey(\'' + k.id + '\')" title="Pausar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>';
        }
      }

      // Botão Banir/Desbanir
      btns += k.status !== 'banned' ?
        '<button class="btn btn-ghost btn-sm" onclick="banKey(\'' + k.id + '\')" title="Banir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button>' :
        '<button class="btn btn-ghost btn-sm" onclick="unbanKey(\'' + k.id + '\')" title="Desbanir"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></button>';

      // Botão Deletar
      btns += '<button class="btn btn-ghost btn-sm" onclick="deleteKey(\'' + k.id + '\')" title="Deletar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>';

      rows += '<tr>' +
        '<td><span class="key-text" onclick="copyKey(\'' + esc(k.key) + '\')" title="Clique para copiar">' + esc(k.key) + '</span></td>' +
        '<td><span class="badge badge-' + statusBadge + '">' + statusLabel + '</span></td>' +
        '<td>' + esc(k.client_name || '—') + '</td>' +
        '<td>' + durationLabel + '</td>' +
        '<td><span class="hwid-text">' + hwid + '</span></td>' +
        '<td>' + fmtDate(k.created_at) + '</td>' +
        '<td>' + (k.expires_at ? fmtDate(k.expires_at) : (k.is_lifetime ? 'Nunca' : '—')) + '</td>' +
        '<td><div class="action-btns">' + btns + '</div></td></tr>';
    }
  }

  var pag = pagination(keysPage, data.total, 25, 'loadKeys');

  c.innerHTML = '<div class="page-header"><h2>Licenças' + appLabel + '</h2><div class="actions">' +
    '<button class="btn btn-ghost btn-sm" onclick="togglePauseAll()" id="pauseAllBtn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pausar Todas</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="exportKeys()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar .TXT</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="showImportKeysModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Importar .TXT</button>' +
    '<button class="btn btn-danger btn-sm" onclick="deleteAllKeys()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Deletar Todas</button>' +
    '<button class="btn btn-primary" onclick="showCreateKeysModal()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Gerar Keys</button></div></div>' +
    '<div class="table-container">' +
    '<div class="table-toolbar"><div class="search-box">' +
    '<input type="text" id="keySearch" placeholder="Buscar key..." value="' + esc(search) + '" onkeypress="if(event.key===\'Enter\')loadKeys(1)">' +
    '<select id="keyStatusFilter" onchange="loadKeys(1)"><option value="">Todos Status</option><option value="unused"' + (sf === 'unused' ? ' selected' : '') + '>Não Usada</option><option value="active"' + (sf === 'active' ? ' selected' : '') + '>Ativa</option><option value="expired"' + (sf === 'expired' ? ' selected' : '') + '>Expirada</option><option value="banned"' + (sf === 'banned' ? ' selected' : '') + '>Banida</option></select>' +
    '</div><button class="btn btn-ghost btn-sm" onclick="loadKeys(' + keysPage + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button></div>' +
    '<div style="overflow-x:auto"><table><thead><tr><th>Key</th><th>Status</th><th>Client</th><th>Duração</th><th>HWID</th><th>Criada</th><th>Expira</th><th>Ações</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="table-footer">' + pag + '</div></div>';

  // Atualizar estado do botão pausar todas
  checkPauseAllState();
}

function exportKeys() {
  var appFilter = currentApp ? ('&app_id=' + currentApp.id) : '';
  api('GET', '/admin/keys?page=1&limit=9999' + appFilter).then(function (data) {
    if (!data || !data.success) { showToast('Erro ao exportar.', 'error'); return; }
    var keys = data.keys || [];
    if (keys.length === 0) { showToast('Nenhuma key para exportar.', 'info'); return; }
    var now = new Date().toISOString().split('T')[0];
    var content = '=== ' + (currentApp ? currentApp.name : 'Todos os Apps') + ' - Exportado em ' + now + ' ===\r\n';
    content += '=== Total: ' + keys.length + ' keys ===\r\n\r\n';
    for (var i = 0; i < keys.length; i++) {
      content += 'Key: ' + keys[i].key + '\r\n';
      content += 'Status: ' + keys[i].status + '\r\n';
      content += 'Client: ' + (keys[i].client_name || '') + '\r\n';
      content += 'Criado: ' + keys[i].created_at + '\r\n';
      content += '---\r\n';
    }
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'keys_' + (currentApp ? currentApp.name.toLowerCase().replace(/\s+/g, '_') : 'todos') + '_' + now + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(keys.length + ' keys exportadas!', 'success');
  });
}

function deleteAllKeys() {
  var scope = currentApp ? 'do app "' + currentApp.name + '"' : 'de TODOS os apps';
  showConfirm('Deletar Todas as Keys', 'Deseletar todas as keys ' + scope + '? Esta ação não pode ser desfeita.', function () {
    var url = currentApp ? '/admin/keys?app_id=' + currentApp.id : '/admin/keys';
    api('DELETE', url).then(function (data) {
      if (data && data.success) { showToast(data.message, 'success'); loadKeys(1); }
      else showToast(data ? data.message : 'Erro', 'error');
    });
  });
}

async function checkPauseAllState() {
  var data = await api('GET', '/admin/dashboard');
  if (!data || !data.success) return;
  var btn = document.getElementById('pauseAllBtn');
  if (!btn) return;
  if (data.stats.paused_keys > 0 && data.stats.active_keys === 0) {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Despausar Todas';
  } else {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pausar Todas';
  }
}

function showCreateKeysModal() {
  openModal(
    '<h3>Gerar Keys' + (currentApp ? ' — ' + esc(currentApp.name) : '') + '</h3>' +
    '<div class="form-group"><label>Quantidade</label><input type="number" id="mkCount" value="1" min="1" max="100"></div>' +
    '<div class="form-group"><label>Nome do Client</label><input type="text" id="mkClientName" placeholder="Opcional (ex: GELADO)"></div>' +
    '<div class="form-group"><label>Duração</label><select id="mkDurationType"><option value="days">Diário (em dias)</option><option value="lifetime">Lifetime</option></select></div>' +
    '<div class="form-group" id="mkDaysGroup"><label>Dias</label><input type="number" id="mkDuration" value="30" min="1"></div>' +
    '<div id="mkResult"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="mkCancelBtn">Cancelar</button><button class="btn btn-primary" id="mkGenerateBtn">Gerar</button></div>'
  );
  setTimeout(function () {
    document.getElementById('mkDurationType').addEventListener('change', function () { toggleDurationInput(); });
    document.getElementById('mkCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('mkGenerateBtn').addEventListener('click', function () { createKeys(); });
  }, 50);
}

function toggleDurationInput() {
  var type = document.getElementById('mkDurationType').value;
  var daysGroup = document.getElementById('mkDaysGroup');
  daysGroup.style.display = type === 'lifetime' ? 'none' : 'block';
}

async function createKeys() {
  var count = parseInt(document.getElementById('mkCount').value) || 1;
  var clientName = document.getElementById('mkClientName').value.trim();
  var durationType = document.getElementById('mkDurationType').value;
  var duration = parseInt(document.getElementById('mkDuration').value) || 30;

  var body = { count: count, duration_type: durationType, client_name: clientName };
  if (durationType === 'days') body.duration_days = duration;
  if (currentApp) body.app_id = currentApp.id;

  var data = await api('POST', '/admin/keys', body);
  if (!data || !data.success) {
    showToast(data ? data.message : 'Erro', 'error');
    return;
  }

  var keysHtml = '<div class="generated-keys">';
  for (var i = 0; i < data.keys.length; i++) {
    keysHtml += '<div class="key-row"><span>' + esc(data.keys[i]) + '</span><button class="btn btn-ghost btn-sm" onclick="copyKey(\'' + esc(data.keys[i]) + '\')">Copiar</button></div>';
  }
  keysHtml += '</div>';

  document.getElementById('mkResult').innerHTML = '<p style="color:var(--success);margin:12px 0 8px;font-weight:600">' + data.count + ' keys geradas!</p>' + keysHtml;
  showToast(data.count + ' keys geradas!', 'success');
  loadKeys(1);
}

async function resetHwid(id) {
  showConfirm('Resetar HWID', 'Deseja resetar o HWID desta key? O usuário poderá ativar em um novo dispositivo. Os dias não serão alterados.', function () {
    api('POST', '/admin/keys/' + id + '/reset-hwid').then(function (data) {
      if (data && data.success) { showToast('HWID resetado!', 'success'); loadKeys(keysPage); }
      else showToast(data ? data.message : 'Erro', 'error');
    });
  });
}

async function togglePauseKey(id) {
  var data = await api('POST', '/admin/keys/' + id + '/pause');
  if (data && data.success) {
    showToast('Key ' + (data.action === 'paused' ? 'pausada!' : 'despausada!'), 'success');
    loadKeys(keysPage);
  } else {
    showToast(data ? data.message : 'Erro', 'error');
  }
}

async function togglePauseAll() {
  var action = 'pausar';
  var btn = document.getElementById('pauseAllBtn');
  if (btn && btn.textContent.indexOf('Despausar') >= 0) action = 'despausar';

  showConfirm(
    action === 'pausar' ? 'Pausar Todas' : 'Despausar Todas',
    action === 'pausar' ? 'Deseja pausar todas as keys ativas? O tempo será congelado.' : 'Deseja despausar todas as keys pausadas? O tempo voltará a contar.',
    function () {
      api('POST', '/admin/keys/pause-all').then(function (data) {
        if (data && data.success) { showToast(data.message, 'success'); loadKeys(keysPage); }
        else showToast(data ? data.message : 'Erro', 'error');
      });
    }
  );
}

function showExtendModal(id) {
  openModal(
    '<h3>Estender Validade</h3>' +
    '<div class="form-group"><label>Dias para adicionar</label><input type="number" id="extDays" value="30" min="1"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="extCancelBtn">Cancelar</button><button class="btn btn-primary" id="extSaveBtn">Estender</button></div>'
  );
  setTimeout(function () {
    document.getElementById('extCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('extSaveBtn').addEventListener('click', function () { extendKey(id); });
  }, 50);
}

async function extendKey(id) {
  var days = parseInt(document.getElementById('extDays').value) || 30;
  var data = await api('POST', '/admin/keys/' + id + '/extend', { days: days });
  if (data && data.success) { showToast('Estendido em ' + days + ' dias!', 'success'); closeModal(); loadKeys(keysPage); }
  else showToast(data ? data.message : 'Erro', 'error');
}

async function banKey(id) {
  showConfirm('Banir Key', 'Deseja banir esta key? Ela não poderá mais ser usada.', function () {
    api('PUT', '/admin/keys/' + id, { status: 'banned' }).then(function (data) {
      if (data && data.success) { showToast('Key banida!', 'success'); loadKeys(keysPage); }
      else showToast(data ? data.message : 'Erro', 'error');
    });
  });
}

async function unbanKey(id) {
  var data = await api('PUT', '/admin/keys/' + id, { status: 'active' });
  if (data && data.success) { showToast('Key desbanida!', 'success'); loadKeys(keysPage); }
  else showToast(data ? data.message : 'Erro', 'error');
}

function showImportKeysModal() {
  openModal(
    '<h3>Importar Keys de .TXT</h3>' +
    '<p style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin-bottom:16px">Selecione o arquivo .TXT exportado anteriormente. As keys que já existem no banco serão ignoradas.</p>' +
    '<div class="form-group">' +
    '<label>Arquivo .TXT</label>' +
    '<input type="file" id="importFile" accept=".txt" style="padding:10px;border:2px dashed var(--border);border-radius:10px;width:100%;cursor:pointer;background:var(--bg-elevated)">' +
    '</div>' +
    '<div id="importPreview" style="display:none;margin-top:12px">' +
    '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:6px"><strong id="importCount">0</strong> keys encontradas no arquivo</div>' +
    '<div id="importList" style="max-height:180px;overflow-y:auto;background:var(--bg-elevated);border-radius:8px;padding:8px;font-family:monospace;font-size:12px;color:var(--text-secondary);line-height:1.8"></div>' +
    '</div>' +
    '<div id="importResult" style="display:none;margin-top:12px;padding:10px;border-radius:8px;font-size:13px"></div>' +
    '<div class="modal-actions" style="margin-top:16px"><button class="btn btn-ghost" id="importCancelBtn">Cancelar</button><button class="btn btn-primary" id="importSubmitBtn" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Importar</button></div>'
  );
  setTimeout(function () {
    document.getElementById('importCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('importSubmitBtn').addEventListener('click', function () { processImport(); });
    document.getElementById('importFile').addEventListener('change', function (e) { handleImportFile(e); });
  }, 50);
}

function handleImportFile(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (evt) {
    var text = evt.target.result;
    var lines = text.split('\n');
    var keys = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('Key:') === 0) {
        var keyVal = line.substring(4).trim();
        if (keyVal) keys.push(keyVal);
      }
    }
    if (keys.length === 0) {
      document.getElementById('importPreview').style.display = 'none';
      document.getElementById('importSubmitBtn').disabled = true;
      showToast('Nenhuma key encontrada no arquivo.', 'error');
      return;
    }
    var previewList = document.getElementById('importList');
    var displayKeys = keys.slice(0, 50);
    var html = '';
    for (var j = 0; j < displayKeys.length; j++) {
      html += esc(displayKeys[j]) + '<br>';
    }
    if (keys.length > 50) {
      html += '<em>...e mais ' + (keys.length - 50) + ' keys</em>';
    }
    previewList.innerHTML = html;
    document.getElementById('importCount').textContent = keys.length;
    document.getElementById('importPreview').style.display = 'block';
    document.getElementById('importSubmitBtn').disabled = false;
    document.getElementById('importFile')._keys = keys;
  };
  reader.readAsText(file);
}

async function processImport() {
  var fileInput = document.getElementById('importFile');
  var keys = fileInput._keys || [];
  if (keys.length === 0) { showToast('Nenhuma key para importar.', 'error'); return; }

  document.getElementById('importSubmitBtn').disabled = true;
  document.getElementById('importSubmitBtn').textContent = 'Importando...';

  var body = { keys: keys };
  if (currentApp) body.app_id = currentApp.id;
  var data = await api('POST', '/admin/keys/import', body);

  if (!data || !data.success) {
    document.getElementById('importSubmitBtn').disabled = false;
    document.getElementById('importSubmitBtn').innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Importar';
    showToast(data ? data.message : 'Erro ao importar.', 'error');
    return;
  }

  var resultEl = document.getElementById('importResult');
  resultEl.style.display = 'block';
  resultEl.style.background = 'rgba(34,197,94,0.1)';
  resultEl.style.color = 'var(--success)';
  resultEl.innerHTML = '✔ ' + data.imported + ' keys importadas com sucesso!' +
    (data.skipped > 0 ? ' (' + data.skipped + ' ignoradas por já existirem)' : '');

  showToast(data.imported + ' keys importadas!', 'success');
  loadKeys(1);
}

async function deleteKey(id) {
  showConfirm('Deletar Key', 'Deseja deletar esta key permanentemente? Esta ação não pode ser desfeita.', function () {
    api('DELETE', '/admin/keys/' + id).then(function (data) {
      if (data && data.success) { showToast('Key deletada!', 'success'); loadKeys(keysPage); }
      else showToast(data ? data.message : 'Erro', 'error');
    });
  });
}

// ============================================================
//  LOGS
// ============================================================
async function loadLogs(page) {
  if (page) logsPage = page;
  var c = document.getElementById('contentArea');
  var appLabel = currentApp ? ' — ' + esc(currentApp.name) : '';
  c.innerHTML = '<div class="page-header"><h2>Logs' + appLabel + '</h2></div><div style="display:flex;align-items:center;justify-content:center;padding:80px;color:var(--text-muted)"><div class="spinner"></div></div>';

  var action = (document.getElementById('logActionFilter') || {}).value || '';
  var search = (document.getElementById('logSearch') || {}).value || '';

  var url = '/admin/logs?page=' + logsPage + '&limit=50';
  if (currentApp) url += '&app_id=' + currentApp.id;
  if (action) url += '&action=' + action;
  if (search) url += '&search=' + encodeURIComponent(search);

  var data = await api('GET', url);
  if (!data || !data.success) {
    c.innerHTML = '<div class="page-header"><h2>Logs</h2></div><div style="text-align:center;padding:60px;color:var(--text-muted)"><p>Não foi possível carregar os logs.</p><button class="btn btn-ghost" onclick="loadLogs(1)">Tentar novamente</button></div>';
    return;
  }

  var logsHtml = '';

  if (data.logs.length === 0) {
    logsHtml = '<div style="padding:48px;text-align:center;color:var(--text-muted)">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="margin:0 auto 12px;display:block;opacity:.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      'Nenhum log encontrado</div>';
  } else {
    for (var i = 0; i < data.logs.length; i++) {
      var l = data.logs[i];
      logsHtml += '<div class="log-entry"><span class="log-time">' + fmtDate(l.created_at) + '</span><span class="log-action ' + logClass(l.action) + '">' + esc(l.action) + '</span><span class="log-details">' + esc(l.details) + '</span></div>';
    }
  }

  var pag = pagination(logsPage, data.total, 50, 'loadLogs');

  c.innerHTML = '<div class="page-header"><h2>Logs</h2><div class="actions">' +
    '<button class="btn btn-danger btn-sm" onclick="clearLogs()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg> Limpar Logs</button>' +
    '<button class="btn btn-ghost" onclick="loadLogs(' + logsPage + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Atualizar</button></div></div>' +
    '<div class="table-container">' +
    '<div class="table-toolbar"><div class="search-box">' +
    '<input type="text" id="logSearch" placeholder="Buscar nos logs..." value="' + esc(search) + '" onkeypress="if(event.key===\'Enter\')loadLogs(1)">' +
    '<select id="logActionFilter" onchange="loadLogs(1)"><option value="">Todas as Ações</option><option value="key_activated"' + (action === 'key_activated' ? ' selected' : '') + '>Key Ativada</option><option value="login_fail"' + (action === 'login_fail' ? ' selected' : '') + '>Login Falhou</option><option value="key_expired"' + (action === 'key_expired' ? ' selected' : '') + '>Key Expirada</option><option value="hwid_reset"' + (action === 'hwid_reset' ? ' selected' : '') + '>HWID Reset</option><option value="key_banned"' + (action === 'key_banned' ? ' selected' : '') + '>Key Banida</option><option value="key_paused"' + (action === 'key_paused' ? ' selected' : '') + '>Key Pausada</option><option value="key_unpaused"' + (action === 'key_unpaused' ? ' selected' : '') + '>Key Despausada</option></select>' +
    '</div><button class="btn btn-ghost btn-sm" onclick="loadLogs(' + logsPage + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button></div>' +
    '<div style="max-height:600px;overflow-y:auto">' + logsHtml + '</div>' +
    '<div class="table-footer">' + pag + '</div></div>';
}

async function clearLogs() {
  showConfirm('Limpar Logs', 'Deseja deletar todos os logs? Esta ação não pode ser desfeita.', function () {
    api('DELETE', '/admin/logs').then(function (data) {
      if (data && data.success) { showToast('Logs limpos!', 'success'); loadLogs(1); }
      else showToast(data ? data.message : 'Erro', 'error');
    });
  });
}

// ============================================================
//  ADMIN ACCOUNT
// ============================================================
function showAdminModal() {
  openModal(
    '<h3>Alterar Senha Admin</h3>' +
    '<div class="form-group"><label>Senha Atual</label><input type="password" id="adminOldPass" placeholder="••••••••"></div>' +
    '<div class="form-group"><label>Nova Senha</label><input type="password" id="adminNewPass" placeholder="••••••••"></div>' +
    '<div class="modal-actions"><button class="btn btn-ghost" id="adminCancelBtn">Cancelar</button><button class="btn btn-primary" id="adminSaveBtn">Salvar</button></div>'
  );
  setTimeout(function () {
    document.getElementById('adminCancelBtn').addEventListener('click', function () { closeModal(); });
    document.getElementById('adminSaveBtn').addEventListener('click', function () { saveAdmin(); });
  }, 50);
}

async function saveAdmin() {
  var old_password = document.getElementById('adminOldPass').value;
  var new_password = document.getElementById('adminNewPass').value;
  if (!old_password || !new_password) { showToast('Preencha todos os campos.', 'error'); return; }
  if (new_password.length < 6) { showToast('Nova senha deve ter no mínimo 6 caracteres.', 'error'); return; }
  var data = await api('PUT', '/admin/account', { old_password: old_password, new_password: new_password });
  if (data && data.success) { showToast('Senha alterada!', 'success'); closeModal(); }
  else showToast(data ? data.message : 'Erro', 'error');
}

// ============================================================
//  INIT
// ============================================================
if (token) {
  api('GET', '/admin/dashboard').then(function (data) {
    if (data && data.success) showApp();
    else { token = ''; localStorage.removeItem('admin_token'); showLogin(); }
  });
} else {
  showLogin();
}
