/* ==========================================================================
   Saúde+ — Cliente HTTP + helpers de autenticação
   Usado por auth.html, dashboard.html e admin.html.
   Define window.API_BASE antes desse script se a API não estiver em
   http://localhost:4000.
   ========================================================================== */
(function () {
  var DEFAULT_BASE = 'http://localhost:4000';
  window.API_BASE = window.API_BASE || DEFAULT_BASE;

  var TOKEN_KEY = 'saude_token';
  var USER_KEY = 'saude_user';
  var REFRESH_KEY = 'saude_refresh';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getRefreshToken() { return localStorage.getItem(REFRESH_KEY); }
  function getStoredUser() {
    var raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function setSession(token, user, refreshToken) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }

  // Troca o refresh por um par novo (Fase 0, item 0.3). Retorna true se renovou.
  async function tryRefresh() {
    var refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      var res = await fetch(window.API_BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken })
      });
      if (!res.ok) return false;
      var data = await res.json();
      setSession(data.token, data.user, data.refreshToken);
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function request(method, path, body, _retried) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var res = await fetch(window.API_BASE + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 204) return null;

    var data = null;
    try { data = await res.json(); } catch (_e) { /* resposta sem corpo JSON */ }

    if (!res.ok) {
      // Access curto (15 min): tenta renovar uma vez antes de deslogar.
      // Não aplica a /auth/* (evita recursão no próprio refresh/login).
      if (res.status === 401 && !_retried && path.indexOf('/auth/') !== 0 && await tryRefresh()) {
        return request(method, path, body, true);
      }
      if (res.status === 401) clearSession();
      var message = (data && (data.error || data.message)) || ('Erro inesperado (' + res.status + ')');
      throw new Error(message);
    }
    return data;
  }

  // ---- HTTP genérico ----
  window.apiGet = function (path) { return request('GET', path); };
  window.apiPost = function (path, body) { return request('POST', path, body); };
  window.apiPut = function (path, body) { return request('PUT', path, body); };
  window.apiPatch = function (path, body) { return request('PATCH', path, body); };
  window.apiDelete = function (path) { return request('DELETE', path); };

  // ---- Autenticação ----
  window.authLogin = async function (email, password) {
    var data = await request('POST', '/auth/login', { email: email, password: password });
    setSession(data.token, data.user, data.refreshToken);
    return data;
  };

  window.authSignup = function (payload) {
    return request('POST', '/auth/signup', payload);
  };

  window.setSession = setSession;
  window.signOut = function () {
    // Revoga o refresh no servidor (best-effort) antes de limpar a sessão local.
    var refreshToken = getRefreshToken();
    if (refreshToken) {
      fetch(window.API_BASE + '/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken })
      }).catch(function () { /* logout local vale mesmo se a rede falhar */ });
    }
    clearSession();
    location.href = 'auth.html';
  };

  // getSession é assíncrono de propósito: mantém espaço para, no futuro,
  // revalidar o token contra GET /auth/me em vez de confiar só no cache local.
  window.getSession = async function () {
    var token = getToken();
    var user = getStoredUser();
    if (!token || !user) return null;
    return { token: token, user: user };
  };

  window.requireAuth = async function () {
    var session = await getSession();
    if (!session) {
      location.replace('auth.html');
      return null;
    }
    return session;
  };

  function redirectByRole(role) {
    if (role === 'admin') {
      location.replace('admin.html');
    } else if (role === 'atendente') {
      location.replace('atendente.html');
    } else {
      location.replace('dashboard.html');
    }
  }

  window.requireRole = async function (allowedRoles) {
    var session = await getSession();
    if (!session) {
      location.replace('auth.html');
      return null;
    }
    if (!Array.isArray(allowedRoles) || !allowedRoles.includes(session.user.role)) {
      redirectByRole(session.user.role);
      return null;
    }
    return session;
  };

  window.isAdmin = async function () {
    var session = await getSession();
    return !!(session && session.user && session.user.role === 'admin');
  };

  // ---- Validadores de documento (P2a.4: fonte única no front) ----
  // Mesmas regras do back (server/src/utils/validators.js). Antes o CNS só
  // checava 15 dígitos no front e o CPF tinha cópia divergente em auth.html.
  function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }

  window.isValidCPF = function (value) {
    var cpf = digitsOnly(value);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    var sum = 0, i, d;
    for (i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    d = (sum * 10) % 11; if (d === 10) d = 0;
    if (d !== Number(cpf[9])) return false;
    sum = 0;
    for (i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    d = (sum * 10) % 11; if (d === 10) d = 0;
    return d === Number(cpf[10]);
  };

  // CNS: regra oficial DEF-CNS (15 dígitos com início 1/2/7/8/9 + DV).
  window.isValidCNS = function (value) {
    var cns = digitsOnly(value);
    if (!/^[12789]\d{14}$/.test(cns)) return false;
    var sum = 0, i;
    for (i = 0; i < 15; i++) sum += Number(cns[i]) * (15 - i);
    if (sum % 11 === 0) return true;
    if (cns[0] === '1' || cns[0] === '2') return (sum + 2) % 11 === 0;
    return false;
  };

  // ---- Helpers de UI ----
  window.fmtDate = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  var toastTimer;
  window.toast = function (message, type) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'toast show' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3500);
  };
})();
