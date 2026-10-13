/* ==========================================================================
   Saúde+ — helpers de UI compartilhados (P2a.2)
   Antes duplicados em auth.html e dashboard.html (e ausentes no admin, que
   mostrava erro só via toast). API aceita o CONTROLE ou o WRAPPER .field.
   ========================================================================== */
(function () {
  function wrapperOf(el) {
    if (!el) return null;
    if (el.classList && el.classList.contains('field')) return el;
    const w = el.closest ? el.closest('.field') : null;
    return w && w !== document.body ? w : null;
  }

  function controlOf(el) {
    if (!el) return null;
    if (el.classList && el.classList.contains('field')) {
      return el.querySelector('input, select, textarea');
    }
    return el;
  }

  window.setFieldError = function (el, message) {
    const field = wrapperOf(el);
    const control = controlOf(el);
    if (field) {
      field.classList.add('has-error');
      let msg = field.querySelector('.field-msg');
      if (!msg) { msg = document.createElement('small'); msg.className = 'field-msg'; field.appendChild(msg); }
      msg.textContent = message;
    } else if (control) {
      control.classList.add('has-error');
    } else {
      window.toast ? window.toast(message, 'error') : null;
      return;
    }
    if (control) control.classList.add('has-error');
    if (control) control.setAttribute('aria-invalid', 'true');
  };

  window.clearFieldError = function (el) {
    const field = wrapperOf(el);
    const control = controlOf(el);
    if (field) {
      field.classList.remove('has-error');
      const msg = field.querySelector('.field-msg');
      if (msg) msg.remove();
    }
    if (control) {
      control.classList.remove('has-error');
      control.removeAttribute('aria-invalid');
    }
  };

  window.fieldOf = function (controlEl) {
    return controlEl ? wrapperOf(controlEl) : null;
  };

  window.showFirstError = function (el) {
    if (!el) return;
    const target = wrapperOf(el) || el;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = controlOf(el);
    if (control && control.focus) {
      try { control.focus({ preventScroll: true }); } catch (e) { control.focus(); }
    }
  };

  /* ---- Máscaras de documento/telefone/CEP (P4: compartilhadas auth ↔ perfil) ---- */
  window.maskCpf = function (el) {
    let v = el.value.replace(/\D/g, '').slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    el.value = v;
  };
  window.maskRg = function (el) {
    let v = el.value.replace(/[^0-9Xx]/g, '').slice(0, 9);
    let out = v.slice(0, 2);
    if (v.length > 2) out += '.' + v.slice(2, 5);
    if (v.length > 5) out += '.' + v.slice(5, 8);
    if (v.length > 8) out += '-' + v.slice(8);
    el.value = out;
  };
  window.maskCns = function (el) {
    let v = el.value.replace(/\D/g, '').slice(0, 15);
    if (v.length > 3) v = v.slice(0, 3) + ' ' + v.slice(3);
    if (v.length > 8) v = v.slice(0, 8) + ' ' + v.slice(8);
    if (v.length > 13) v = v.slice(0, 13) + ' ' + v.slice(13);
    el.value = v;
  };
  window.maskPhone = function (el, mob) {
    let v = el.value.replace(/\D/g, '').slice(0, mob ? 11 : 10);
    if (mob) v = v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
    else v = v.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    el.value = v;
  };
  window.maskCep = function (el) {
    let v = el.value.replace(/\D/g, '').slice(0, 8);
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    el.value = v;
  };

  /* ---- ViaCEP genérico (P4: usado pela aba Meu perfil) ----
     map: { street, neighborhood, city, state } com ids dos campos destino. */
  window.lookupCep = async function (cepId, map) {
    const cepEl = document.getElementById(cepId);
    if (!cepEl) return;
    const cep = cepEl.value.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
      const d = await r.json();
      if (d.erro) { window.toast && window.toast('CEP não encontrado.', 'error'); return; }
      const set = (id, v) => { const el = id && document.getElementById(id); if (el) el.value = v || ''; };
      set(map.street, d.logradouro);
      set(map.neighborhood, d.bairro);
      set(map.city, d.localidade);
      set(map.state, d.uf);
    } catch (e) { /* sem internet — usuário preenche manualmente */ }
  };

  /* ---- Teclado em tablists (APG): setas/Home/End entre [role=tab] ----
     Auto-init para todas as páginas (dashboard, atendente, admin, auth).
     Usa .click() para preservar o comportamento existente de cada aba. */
  function tablistKeys(e) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
    var tab = e.target && e.target.closest ? e.target.closest('[role="tab"]') : null;
    if (!tab) return;
    var list = tab.closest('[role="tablist"]');
    if (!list) return;
    var tabs = Array.prototype.filter.call(
      list.querySelectorAll('[role="tab"]'),
      function (t) { return !t.disabled && t.offsetParent !== null; }
    );
    if (tabs.length < 2) return;
    e.preventDefault();
    var i = tabs.indexOf(tab);
    var next;
    if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    else {
      var dir = e.key === 'ArrowRight' ? 1 : -1;
      next = tabs[(i + dir + tabs.length) % tabs.length];
    }
    if (next) { next.focus(); if (next !== tab) next.click(); }
  }

  /* ---- Esc fecha o diálogo aberto (.show) ----
     Chama o closer dedicado de cada modal (limpa pendências); o modal de
     senha do dashboard resolve a promessa com null (cancelamento). */
  window.closeTopModal = function () {
    var pairs = [
      ['passwordModal', 'finishPassword', null],
      ['reviewModal', 'closeReviewModal'],
      ['cancelModal', 'closeCancelModal'],
      ['reagendarModal', 'closeReagendarModal'],
      ['deleteDiseaseModal', 'closeDeleteDiseaseModal'],
      ['diseaseEditModal', 'closeDiseaseModal'],
      ['deleteAccountModal', 'closeDeleteAccountModal'],
      ['deleteAtAccountModal', 'closeAtDeleteModal']
    ];
    for (var i = 0; i < pairs.length; i++) {
      var m = document.getElementById(pairs[i][0]);
      if (m && m.classList.contains('show')) {
        var fn = window[pairs[i][1]];
        try {
          if (typeof fn === 'function') {
            if (pairs[i].length > 2) fn(pairs[i][2]);
            else fn();
          } else {
            m.classList.remove('show');
          }
        } catch (_e) { m.classList.remove('show'); }
        return true;
      }
    }
    return false;
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (window.closeTopModal()) { e.stopPropagation(); return; }
    }
    tablistKeys(e);
  });
})();
