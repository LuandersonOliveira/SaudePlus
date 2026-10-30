/* ==========================================================================
   Saude+ - Agenda operacional compartilhada (Fase 2)
   Mesmo modulo usado por admin.html e atendente.html.
   ========================================================================== */
(function () {
  "use strict";

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function monthStr(dateStr) {
    return String(dateStr || todayStr()).slice(0, 7);
  }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function apiGet(path) { return (window.apiGet || function (p) { return fetch(window.API_BASE + p, { headers: { Authorization: "Bearer " + localStorage.getItem("saude_token") } }).then(function (r) { return r.json(); }); })(path); }
  function apiPost(path, body) { return (window.apiPost || function (p, b) { return fetch(window.API_BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("saude_token") }, body: JSON.stringify(b) }).then(function (r) { return r.json(); }); })(path, body); }
  function apiPatch(path, body) { return fetch(window.API_BASE + path, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("saude_token") }, body: JSON.stringify(body) }).then(async function (r) { var d = null; try { d = await r.json(); } catch (e) {} if (!r.ok) throw new Error((d && d.error) || "Erro inesperado"); return d; }); }

  function toast(msg, type) {
    if (window.toast) window.toast(msg, type || "info");
    else console.log(msg);
  }

  function statusLabel(status) {
    return { pendente: "Pendente", confirmado: "Confirmado", para_remarcar: "Para remarcar", concluido: "Concluido", cancelado: "Cancelado" }[status] || status;
  }

  function iniciar(root, options) {
    options = options || {};
    var state = {
      date: options.date || todayStr(),
      month: monthStr(options.date || todayStr()),
      tab: "dia",
      tipo: "all",
      unitId: "",
      professionalId: "",
      items: [],
      monthDays: [],
      patients: [],
      selectedPatient: null,
      kind: "consulta",
    };

    root.innerHTML = ""
      + "<div class=\"agenda-shell\">"
      + "<div class=\"row\" style=\"align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px\">"
      + "<div class=\"tabs\" role=\"tablist\" aria-label=\"Abas da agenda\">"
      + "<button type=\"button\" class=\"tab active\" data-agenda-tab=\"dia\">Dia</button>"
      + "<button type=\"button\" class=\"tab\" data-agenda-tab=\"remarcar\">Para remarcar</button>"
      + "</div>"
      + "<button type=\"button\" class=\"btn btn-outline btn-sm\" data-action=\"relatorio\">Relatório</button>"
      + "<button type=\"button\" class=\"btn btn-primary btn-sm\" data-action=\"novo\">Novo agendamento</button>"
      + "</div>"
      + "<div class=\"grid grid-3\" style=\"gap:12px;margin-bottom:12px\">"
      + "<div class=\"field\"><label>Data</label><input class=\"input\" type=\"date\" data-field=\"date\"></div>"
      + "<div class=\"field\"><label>Tipo</label><select class=\"select\" data-field=\"tipo\"><option value=\"all\">Todos</option><option value=\"consulta\">Consultas</option><option value=\"exame\">Exames</option></select></div>"
      + "<div class=\"field\"><label>Unidade</label><input class=\"input\" data-field=\"unit\" placeholder=\"Id da unidade (opcional)\"></div>"
      + "</div>"
      + "<div class=\"card\" style=\"margin-bottom:12px\"><h3>Resumo do dia</h3><div data-summary></div></div>"
      + "<div class=\"grid grid-2\" style=\"gap:12px\">"
      + "<div class=\"card\"><h3>Calendario</h3><div data-nav class=\"row\" style=\"justify-content:space-between;margin-bottom:8px\"><button class=\"btn btn-outline btn-sm\" data-action=\"prev-month\">&lt;</button><strong data-month-label></strong><button class=\"btn btn-outline btn-sm\" data-action=\"next-month\">&gt;</button></div><div data-calendar></div></div>"
      + "<div class=\"card\"><h3 data-day-title></h3><div data-day-list><div class=\"muted\">Carregando...</div></div></div>"
      + "</div>"
      + "</div>";

    function q(sel) { return root.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

    async function carregarDia() {
      var url = "/staff/agenda?date=" + encodeURIComponent(state.date) + "&tipo=" + encodeURIComponent(state.tipo);
      if (state.unitId) url += "&unit_id=" + encodeURIComponent(state.unitId);
      var data = await apiGet(url);
      state.items = (data && data.items) ? data.items : [];
      renderResumo(data && data.summary);
      renderLista();
    }

    function renderResumo(summary) {
      summary = summary || {};
      var el = q("[data-summary]");
      if (!el) return;
      el.innerHTML = "<span class=\"badge\">Total: " + esc(summary.total || 0) + "</span> "
        + "<span class=\"badge\">Pendentes: " + esc(summary.pendente || 0) + "</span> "
        + "<span class=\"badge\">Confirmados: " + esc(summary.confirmado || 0) + "</span> "
        + "<span class=\"badge\">Para remarcar: " + esc(summary.para_remarcar || 0) + "</span>";
      q("[data-day-title]").textContent = "Atendimentos de " + state.date;
    }

    function itensVisiveis() {
      if (state.tab === "remarcar") return state.items.filter(function (i) { return i.status === "para_remarcar"; });
      return state.items;
    }

    function renderLista() {
      var el = q("[data-day-list]");
      if (!el) return;
      var itens = itensVisiveis();
      if (!itens.length) { el.innerHTML = "<p class=\"muted\">Nenhum atendimento neste dia.</p>"; return; }
      el.innerHTML = "<div class=\"table-wrap\"><table class=\"table\"><thead><tr><th>Horario</th><th>Paciente</th><th>Servico</th><th>Prioridade</th><th>Status</th><th>Acoes</th></tr></thead><tbody>" + itens.map(function (i) {
        return "<tr>"
          + "<td>" + esc(String(i.scheduled_at || "").slice(11, 16)) + " (" + esc(i.duration_minutes) + " min)</td>"
          + "<td>" + esc(i.user_name) + "</td>"
          + "<td>" + esc(i.service_name) + "</td>"
          + "<td><span class=\"badge\">" + esc(statusLabel(i.status)) + "</span></td>"
          + "<td>" + esc(i.user_priority || "nenhuma") + "</td>"
          + "<td>"
          + "<button class=\"btn btn-outline btn-sm\" data-act=\"confirmar\" data-id=\"" + esc(i.id) + "\" data-kind=\"" + esc(i.kind) + "\" aria-label=\"Check-in de " + esc(i.user_name) + " as " + esc(String(i.scheduled_at || "").slice(11, 16)) + "\">Check-in</button> "
          + "<button class=\"btn btn-outline btn-sm\" data-act=\"concluir\" data-id=\"" + esc(i.id) + "\" data-kind=\"" + esc(i.kind) + "\" aria-label=\"Registrar atendimento de " + esc(i.user_name) + "\">Registrar</button> "
          + "<button class=\"btn btn-outline btn-sm\" data-act=\"cancelar\" data-id=\"" + esc(i.id) + "\" data-kind=\"" + esc(i.kind) + "\" aria-label=\"Cancelar atendimento de " + esc(i.user_name) + "\">Cancelar</button> "
          + "<button class=\"btn btn-outline btn-sm\" data-act=\"remarcar\" data-id=\"" + esc(i.id) + "\" data-kind=\"" + esc(i.kind) + "\" aria-label=\"Remarcar atendimento de " + esc(i.user_name) + "\">Remarcar</button> "
          + "<button class=\"btn btn-outline btn-sm\" data-act=\"historico\" data-id=\"" + esc(i.id) + "\" data-kind=\"" + esc(i.kind) + "\" aria-label=\"Ver historico de " + esc(i.user_name) + "\">Historico</button>"
          + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    }

    async function carregarMes() {
      var url = "/staff/agenda/month?month=" + encodeURIComponent(state.month) + "&tipo=" + encodeURIComponent(state.tipo);
      if (state.unitId) url += "&unit_id=" + encodeURIComponent(state.unitId);
      var data = await apiGet(url);
      state.monthDays = (data && data.days) ? data.days : [];
      q("[data-month-label]").textContent = state.month;
      renderCalendario();
    }

    function renderCalendario() {
      var el = q("[data-calendar]");
      if (!el) return;
      var porDia = new Map(state.monthDays.map(function (d) { return [d.date, d]; }));
      var primeiro = new Date(state.month + "-01T00:00:00");
      var inicio = new Date(primeiro);
      inicio.setDate(inicio.getDate() - inicio.getDay());
      var html = "<div class=\"grid\" style=\"grid-template-columns:repeat(7,1fr);gap:4px;font-size:12px\">";
      var nomes = ["D", "S", "T", "Q", "Q", "S", "S"];
      for (var n = 0; n < nomes.length; n++) html += "<div style=\"text-align:center;font-weight:700\">" + nomes[n] + "</div>";
      for (var i = 0; i < 42; i++) {
        var d = new Date(inicio);
        d.setDate(d.getDate() + i);
        var s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        var info = porDia.get(s);
        var noMes = d.getMonth() === primeiro.getMonth();
        html += "<button type=\"button\" class=\"btn btn-outline btn-sm\" data-agenda-date=\"" + esc(s) + "\" style=\"opacity:" + (noMes ? 1 : 0.35) + "\">" + esc(d.getDate()) + (info ? "<br><small>" + esc(info.total) + "</small>" : "") + "</button>";
      }
      html += "</div>";
      el.innerHTML = html;
    }

    async function atualizar() {
      await carregarDia();
      await carregarMes();
    }

    async function acaoConfirmar(kind, id) {
      await apiPatch("/staff/" + kind + "s/" + encodeURIComponent(id), { status: "confirmado" });
      toast("Confirmado", "success");
      await carregarDia();
    }

    async function acaoCancelar(kind, id) {
      var motivo = window.prompt("Motivo do cancelamento:");
      if (!motivo) return;
      await apiPatch("/staff/" + kind + "s/" + encodeURIComponent(id), { status: "cancelado", reschedule_reason: motivo, outcome: "recusou" });
      toast("Cancelado", "success");
      await carregarDia();
    }

    async function acaoConcluir(kind, id) {
      var outcome = window.prompt("Desfecho (compareceu, faltou, recusou, desistiu):", "compareceu");
      if (!outcome) return;
      await apiPatch("/staff/" + kind + "s/" + encodeURIComponent(id), { status: "concluido", outcome: outcome });
      toast("Registrado", "success");
      await carregarDia();
    }

    async function acaoHistorico(kind, id) {
      try {
        var rows = await apiGet("/staff/booking-events?kind=" + encodeURIComponent(kind) + "&booking_id=" + encodeURIComponent(id));
        var texto = (rows || []).map(function (r) { return r.event_type + " - " + r.created_at + (r.reason ? " (" + r.reason + ")" : ""); }).join("\\n");
        window.alert(texto || "Sem historico.");
      } catch (err) { toast(err.message || "Erro ao carregar historico", "error"); }
    }

    async function acaoRelatorio() {
      try {
        var r = await apiGet("/staff/agenda/reports?from=" + encodeURIComponent(addDays(state.date, -30)) + "&to=" + encodeURIComponent(state.date));
        var texto = "Total: " + (r.total || 0)
          + "\\nConfirmados: " + ((r.totals && r.totals.confirmados) || 0)
          + "\\nConcluidos: " + ((r.totals && r.totals.concluidos) || 0)
          + "\\nCancelados: " + ((r.totals && r.totals.cancelados) || 0)
          + "\\nPara remarcar: " + ((r.totals && r.totals.para_remarcar) || 0)
          + "\\nFaltas: " + ((r.totals && r.totals.faltas) || 0)
          + "\\nOcupacao: " + (r.occupancy_rate === null ? "n/d" : Math.round(r.occupancy_rate * 100) + "%")
          + "\\nAbsenteismo: " + (r.absence_rate === null ? "n/d" : Math.round(r.absence_rate * 100) + "%");
        window.alert(texto);
      } catch (err) { toast(err.message || "Erro ao carregar relatorio", "error"); }
    }

    async function acaoRemarcar(kind, id) {
      var quando = window.prompt("Nova data e hora (YYYY-MM-DD HH:MM:SS):");
      if (!quando) return;
      var motivo = window.prompt("Motivo da remarcação:") || "solicitado_pelo_paciente";
      await apiPatch("/staff/" + kind + "s/" + encodeURIComponent(id), { scheduled_at: quando, reschedule_reason: motivo });
      toast("Remarcado", "success");
      state.date = quando.slice(0, 10);
      q("[data-field='date']").value = state.date;
      await atualizar();
    }

    function abrirModalNovo() {
      var overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = ""
        + "<div class=\"modal-card modal-card-wide\">"
        + "<h2>Novo agendamento</h2>"
        + "<div class=\"field\"><label>Tipo</label><select class=\"select\" id=\"agKind\"><option value=\"consulta\">Consulta</option><option value=\"exame\">Exame</option></select></div>"
        + "<div class=\"field\"><label>Buscar paciente</label><input class=\"input\" id=\"agPatientQ\" placeholder=\"Nome ou e-mail\"></div>"
        + "<div id=\"agPatientList\" style=\"max-height:160px;overflow:auto;margin-bottom:8px\"></div>"
        + "<div class=\"field\"><label>Servico</label><input class=\"input\" id=\"agService\" placeholder=\"Nome do servico cadastrado\"></div>"
        + "<div class=\"field\"><label>Unidade</label><input class=\"input\" id=\"agUnit\" placeholder=\"Id da unidade\"></div>"
        + "<div class=\"field\"><label>Profissional</label><input class=\"input\" id=\"agProfessional\" placeholder=\"Id do profissional (opcional)\"></div>"
        + "<div class=\"field\"><label>Data e hora</label><input class=\"input\" id=\"agWhen\" placeholder=\"YYYY-MM-DD HH:MM:SS\"></div>"
        + "<div class=\"field\"><label>Local</label><input class=\"input\" id=\"agLocation\" placeholder=\"Local\"></div>"
        + "<div class=\"modal-actions\"><button class=\"btn btn-outline\" type=\"button\" id=\"agCancel\">Cancelar</button><button class=\"btn btn-primary\" type=\"button\" id=\"agSave\">Salvar</button></div>"
        + "</div>";
      document.body.appendChild(overlay);

      var kindEl = overlay.querySelector("#agKind");
      var qEl = overlay.querySelector("#agPatientQ");
      var listEl = overlay.querySelector("#agPatientList");
      async function buscarPacientes() {
        var termo = qEl.value.trim();
        if (!termo) { listEl.innerHTML = ""; return; }
        var rows = await apiGet("/staff/patients?q=" + encodeURIComponent(termo));
        listEl.innerHTML = (rows || []).map(function (p) {
          return "<button type=\"button\" class=\"btn btn-outline btn-sm\" data-patient=\"" + esc(p.id) + "\" style=\"margin:2px\">" + esc(p.full_name) + "</button>";
        }).join(" ");
        Array.prototype.forEach.call(listEl.querySelectorAll("[data-patient]"), function (btn) {
          btn.addEventListener("click", function () { state.selectedPatient = btn.getAttribute("data-patient"); toast("Paciente selecionado", "success"); });
        });
      }
      qEl.addEventListener("input", function () { setTimeout(buscarPacientes, 250); });
      overlay.querySelector("#agCancel").addEventListener("click", function () { document.body.removeChild(overlay); });
      overlay.querySelector("#agSave").addEventListener("click", async function () {
        try {
          var path = state.kind === "consulta" ? "/staff/appointments" : "/staff/exams";
          var body = {
            user_id: state.selectedPatient,
            unit_id: overlay.querySelector("#agUnit").value.trim(),
            professional_id: overlay.querySelector("#agProfessional").value.trim() || null,
            scheduled_at: overlay.querySelector("#agWhen").value.trim(),
            location: overlay.querySelector("#agLocation").value.trim() || "UBS",
          };
          if (kindEl.value === "consulta") body.specialty = overlay.querySelector("#agService").value.trim();
          else body.exam_type = overlay.querySelector("#agService").value.trim();
          await apiPost(path, body);
          toast("Agendamento criado", "success");
          document.body.removeChild(overlay);
          state.date = body.scheduled_at.slice(0, 10);
          q("[data-field='date']").value = state.date;
          await atualizar();
        } catch (err) { toast(err.message || "Erro ao criar", "error"); }
      });
    }

    function atualizarTabs() {
      qa("[data-agenda-tab]").forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-agenda-tab") === state.tab);
      });
    }

    root.addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-action], [data-agenda-tab], [data-agenda-date], [data-act]");
      if (!btn) return;
      if (btn.getAttribute("data-agenda-tab")) {
        state.tab = btn.getAttribute("data-agenda-tab");
        atualizarTabs();
        renderLista();
        return;
      }
      var action = btn.getAttribute("data-action");
      if (action === "novo") { abrirModalNovo(); return; }
      if (action === "relatorio") { await acaoRelatorio(); return; }
      if (action === "prev-month") { var d = new Date(state.month + "-01"); d.setMonth(d.getMonth() - 1); state.month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); await carregarMes(); return; }
      if (action === "next-month") { var d2 = new Date(state.month + "-01"); d2.setMonth(d2.getMonth() + 1); state.month = d2.getFullYear() + "-" + String(d2.getMonth() + 1).padStart(2, "0"); await carregarMes(); return; }
      if (btn.getAttribute("data-agenda-date")) { state.date = btn.getAttribute("data-agenda-date"); q("[data-field='date']").value = state.date; await carregarDia(); return; }
      var act = btn.getAttribute("data-act");
      if (act === "confirmar") { await acaoConfirmar(btn.getAttribute("data-kind"), btn.getAttribute("data-id")); return; }
      if (act === "cancelar") { await acaoCancelar(btn.getAttribute("data-kind"), btn.getAttribute("data-id")); return; }
      if (act === "concluir") { await acaoConcluir(btn.getAttribute("data-kind"), btn.getAttribute("data-id")); return; }
      if (act === "historico") { await acaoHistorico(btn.getAttribute("data-kind"), btn.getAttribute("data-id")); return; }
      if (act === "remarcar") { await acaoRemarcar(btn.getAttribute("data-kind"), btn.getAttribute("data-id")); return; }
    });

    qa("[data-field]").forEach(function (el) {
      el.addEventListener("change", function () {
        state.date = q("[data-field='date']").value || state.date;
        state.tipo = q("[data-field='tipo']").value || "all";
        state.unitId = q("[data-field='unit']").value.trim();
        atualizar();
      });
    });

    q("[data-field='date']").value = state.date;
    atualizar();
  }

  function initAll() {
    var nodes = document.querySelectorAll("[data-agenda]");
    Array.prototype.forEach.call(nodes, function (node) { iniciar(node); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll);
  else initAll();

  window.initAgenda = iniciar;
})();
