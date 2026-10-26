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

  /* ---- Dica de rolagem em faixas que não cabem ----
     Abas no celular e tabelas no tablet cortam o conteúdo sem avisar: o
     admin via "Auditoria" e "Doenças e alertas" só pela metade e não tinha
     como saber que existia. A faixa recebe data-scroll com a posição real
     (start / middle / end / both) e o CSS desenha o esmaecimento do lado que
     ainda tem conteúdo. */
  function updateScrollHint(el) {
    var max = el.scrollWidth - el.clientWidth;
    if (max <= 2) { el.removeAttribute('data-scroll'); return; }
    var atStart = el.scrollLeft <= 2;
    var atEnd = el.scrollLeft >= max - 2;
    el.setAttribute('data-scroll', atStart ? 'end' : (atEnd ? 'start' : 'both'));
  }
  window.initScrollHint = function (el) {
    if (!el || el.dataset.scrollHint === '1') return el;
    el.dataset.scrollHint = '1';
    updateScrollHint(el);
    el.addEventListener('scroll', function () { updateScrollHint(el); }, { passive: true });
    if (window.ResizeObserver) {
      new window.ResizeObserver(function () { updateScrollHint(el); }).observe(el);
    }
    return el;
  };

  /* ---- Modal genérico: foco preso, scroll do fundo travado, backdrop e Esc ----
     Substitui os 4 <style> injetados que o admin.html criava por conta própria.
     O escopo (mais recente por último) é o que decide qual Esc fecha o quê:
     closeTopModal() varre a tabela legada e cai neste registro se não achar
     nenhum modal antigo aberto. */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),'
    + 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var modalStack = [];

  function focusablesOf(modal) {
    return Array.prototype.filter.call(modal.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  window.openModal = function (id) {
    var modal = typeof id === 'string' ? document.getElementById(id) : id;
    if (!modal) return null;
    if (!modal.dataset.modalWired) {
      modal.dataset.modalWired = '1';
      // Clique no fundo fecha. Marcando data-modal-persist a página declara
      // que aquele modal não pode ser dispensado por engano.
      modal.addEventListener('mousedown', function (ev) {
        if (ev.target === modal && modal.dataset.modalPersist !== '1') window.closeModal(modal);
      });
    }
    var entry = { modal: modal, returnTo: document.activeElement };
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    modalStack.push(entry);
    var first = modal.querySelector('[data-modal-autofocus]') || focusablesOf(modal)[0];
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    }
    return modal;
  };

  window.closeModal = function (id) {
    var modal = typeof id === 'string' ? document.getElementById(id) : id;
    if (!modal) return;
    var entry = null;
    modal.classList.remove('show');
    for (var i = modalStack.length - 1; i >= 0; i--) {
      if (modalStack[i].modal === modal) { entry = modalStack.splice(i, 1)[0]; break; }
    }
    // Só destrava a página quando não sobrou nenhum outro modal aberto.
    if (!document.querySelector('.modal-overlay.show')) document.body.classList.remove('modal-open');
    // Devolve o foco para onde o admin estava: sem isso o Tab seguinte caía
    // no <body> e o teclado parecia morto depois de fechar um diálogo.
    if (entry && entry.returnTo && entry.returnTo.focus) {
      try { entry.returnTo.focus({ preventScroll: true }); } catch (e) { /* elemento saiu do DOM */ }
    }
  };

  // Tab circula dentro do modal: sem isto o teclado vazava para a página de
  // trás, que continua visível por baixo do scrim.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var open = modalStack[modalStack.length - 1];
    if (!open) return;
    var list = focusablesOf(open.modal);
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    var inside = open.modal.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
      e.preventDefault(); first.focus();
    }
  });

  /* ---- Confirmação reutilizável -> Promise<boolean> ----
     Base dos avisos de ação destrutiva. Texto via textContent: a mensagem
     costuma embuti nome de paciente e serviço vindos da API. */
  window.confirmDialog = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var anterior = document.getElementById('confirmModal');
      if (anterior) anterior.remove();
      var danger = opts.danger !== false;
      var wrap = document.createElement('div');
      wrap.id = 'confirmModal';
      wrap.className = 'modal-overlay';
      wrap.setAttribute('role', danger ? 'alertdialog' : 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-labelledby', 'confirmModalTitle');
      wrap.setAttribute('aria-describedby', 'confirmModalText');
      wrap.innerHTML =
        '<div class="modal-card">'
        + '<h2 id="confirmModalTitle"></h2>'
        + '<p id="confirmModalText" class="muted"></p>'
        + '<div class="modal-actions">'
        + '<button type="button" class="btn btn-outline" data-confirm="no"></button>'
        + '<button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '"'
        + ' data-confirm="yes" data-modal-autofocus></button>'
        + '</div></div>';
      wrap.querySelector('#confirmModalTitle').textContent = opts.title || 'Confirma esta ação?';
      wrap.querySelector('#confirmModalText').textContent = opts.message || '';
      wrap.querySelector('[data-confirm="no"]').textContent = opts.cancelLabel || 'Cancelar';
      wrap.querySelector('[data-confirm="yes"]').textContent = opts.confirmLabel || 'Confirmar';
      document.body.appendChild(wrap);
      var settled = false;
      var finish = function (value) {
        if (settled) return;
        settled = true;
        window.closeModal(wrap);
        wrap.remove();
        resolve(value);
      };
      wrap.addEventListener('click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('[data-confirm]') : null;
        if (btn) finish(btn.dataset.confirm === 'yes');
      });
      // Esc chega por closeTopModal(), que lê data-modal-close.
      wrap.setAttribute('data-modal-close', 'closeConfirmModal');
      window.closeConfirmModal = function () { finish(false); };
      window.openModal(wrap);
    });
  };

  /* ---- Botão com estado de espera ----
     Sem isto, um segundo toque durante o request disparava a mesma ação duas
     vezes (não há loading nativo em 15 handlers do admin). */
  window.loadingButton = async function (btn, task) {
    if (!btn) return task();
    if (btn.dataset.busy === '1') return;           // já em voo: ignora o 2º toque
    var original = btn.textContent.replace(/…$/, '');
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = original + '…';
    try {
      return await task();
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.dataset.busy = '0';
      btn.textContent = original;
    }
  };

  /* ---- Skeleton e estados de lista, para as caixas de resultado ---- */
  window.skeleton = function (n) {
    var out = '<div class="skel-wrap" aria-hidden="true">';
    for (var i = 0; i < (n || 3); i++) out += '<span class="skel"></span>';
    return out + '</div>';
  };

  /* kind: 'empty' | 'error'. Com retry, monta um botão que dispara a função.
     Antes o erro saía só em toast (3,5s) e o container ficava com o skeleton
     piscando para sempre. */
  window.stateMessage = function (kind, message, retryFn) {
    var box = document.createElement('div');
    box.className = kind === 'error' ? 'state-error' : 'empty';
    // role=alert: o leitor de tela anuncia o erro no momento em que ele entra,
    // sem depender do container ter aria-live.
    if (kind === 'error') box.setAttribute('role', 'alert');
    var texto = document.createElement('p');
    texto.textContent = message;
    box.appendChild(texto);
    if (kind === 'error' && retryFn) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-sm';
      btn.textContent = 'Tentar de novo';
      btn.addEventListener('click', function () { retryFn(); });
      box.appendChild(btn);
    }
    return box;
  };

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
    // Modal novo (.modal-overlay) sem par legado: usa o closer declarado em
    // data-modal-close ou o closeModal padrão.
    var generic = document.querySelector('.modal-overlay.show');
    if (generic) {
      var named = generic.getAttribute && generic.getAttribute('data-modal-close');
      var closer = named ? window[named] : null;
      if (typeof closer === 'function') {
        try { closer(generic); } catch (_e2) { window.closeModal(generic); }
      } else {
        window.closeModal(generic);
      }
      return true;
    }
    return false;
  };

  // Helpers de apresentação compartilhados pelos três painéis. Antes cada
  // página os redefinia (e o dashboard ainda emitia style="" inline no stat).
  // ui.js não depende do esc() definido inline em cada página: se a ordem de
  // carregamento mudar, stat() quebraria com ReferenceError.
  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.statusClass = function (s) {
    return s === 'cancelado' ? 'badge-danger'
      : s === 'concluido' ? 'badge-success'
      : s === 'pendente' ? 'badge-warning' : '';
  };
  window.levelClass = function (l) {
    return l === 'alto' ? 'badge-danger'
      : l === 'medio' ? 'badge-warning' : 'badge-success';
  };
  window.stat = function (label, value) {
    return '<div class="card stat-card"><p class="stat-label">' + escapeHtml(label) + '</p>'
      + '<p class="stat-value">' + escapeHtml(value) + '</p></div>';
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (window.closeTopModal()) { e.stopPropagation(); return; }
    }
    tablistKeys(e);
  });
})();
