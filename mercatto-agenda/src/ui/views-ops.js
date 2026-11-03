/* Operational views: Central de Obras, Instalações/Manutenções lists, Agenda Semanal, Mapa de Obras. */
(function () {
  "use strict";
  const A = window.App, C = A.C, Store = A.Store, S = A.S, { $, $$, h, ic, badge } = A;
  const ui = A.ui;
  ui.central = { filter: null };
  ui.list = { instalacao: { view: "status", inst: "", q: "", done: false }, manutencao: { view: "status", inst: "", q: "", done: false } };
  ui.agenda = { view: null, date: null, inst: "", team: "", mat: "", tipo: "" };
  ui.mapa = { range: "semana", inst: "", status: "" };

  const open = j => !["concluida", "cancelada"].includes(j.status);
  const isEmObra = st => st.code === "em_obra" || st.code === "em_obra_escritorio";

  /* =========================== CENTRAL DE OBRAS =========================== */
  const METRICS = [
    { k: "disp", label: "Instaladores disponíveis", icon: "user-check", tone: "success", inst: true, test: (s) => s.code === "disponivel" },
    { k: "emobra", label: "Instaladores em obra", icon: "hard-hat", tone: "warning", inst: true, test: s => isEmObra(s) || s.code === "deslocamento" },
    { k: "andamento", label: "Obras em andamento", icon: "hammer", tone: "warning", test: (j) => j.status === "andamento" },
    { k: "agendadas", label: "Obras agendadas", icon: "calendar-days", tone: "info", test: (j, f) => j.status === "agendada" && !!(j.agenda || {}).inicio && !f.atrasada },
    { k: "atrasadas", label: "Obras atrasadas", icon: "clock", tone: "danger", alert: true, test: (j, f) => f.atrasada || f.excedeu },
    { k: "seminst", label: "Obras sem instalador", icon: "user-x", tone: "danger", alert: true, test: (j, f) => open(j) && j.status !== "rascunho" && f.semInstalador },
    { k: "aguardando", label: "Aguardando confirmação", icon: "message-circle", tone: "accent", test: j => j.status === "aguardando" },
    { k: "hoje", label: "Obras previstas para hoje", icon: "sun", tone: "neutral", test: (j, f, c) => open(j) && f.blocks.some(b => b.date === c.today) }
  ];

  A.views.central = function (el) {
    const c = A.getCtx(), evs = c.events || [];
    const statuses = Object.fromEntries((c.installers || []).filter(i => i.ativo !== false).map(i => [i.id, C.installerStatus(i, c, evs)]));
    const flags = Object.fromEntries(c.jobs.map(j => [j.id, C.jobFlags(j, c)]));
    const count = m => m.inst ? Object.values(statuses).filter(m.test).length : c.jobs.filter(j => m.test(j, flags[j.id], c)).length;
    const F = ui.central.filter;
    let html = `<div class="stack loose">`;
    if (c.virtual) html += migrationBanner();
    if (!c.jobs.length && !(c.installers || []).length) html += `<div class="card">${A.emptyHTML("layout-dashboard", "Nenhuma obra ou instalador cadastrado ainda", "Comece cadastrando os instaladores (com os materiais que cada um instala) e depois as obras.", "Nova obra")}</div>`;
    html += `<div class="stats">${METRICS.map(m => { const n = count(m); return `<button type="button" class="stat${m.alert && n ? " alert" : ""}" data-metric="${m.k}" aria-pressed="${F === m.k}"><span class="stat-icon si-${m.tone}">${ic(m.icon, 17)}</span><span><span class="stat-value">${n}</span><span class="stat-label" style="display:block">${h(m.label)}</span></span></button>`; }).join("")}</div>`;
    if (F) {
      const m = METRICS.find(x => x.k === F);
      if (m.inst) {
        const list = (c.installers || []).filter(i => statuses[i.id] && m.test(statuses[i.id]));
        html += `<section class="card"><div class="card-head"><h2 class="h-section">${h(m.label)} (${list.length})</h2><button class="btn ghost sm" type="button" data-metric="${F}">${ic("x", 14)}Limpar filtro</button></div>${list.length ? `<div>${list.map(i => teamRow(i, statuses[i.id], c)).join("")}</div>` : `<div class="card-body small muted">Nenhum instalador nesta situação.</div>`}</section>`;
      } else {
        const list = c.jobs.filter(j => m.test(j, flags[j.id], c)).sort(byStart);
        html += `<section class="stack"><div class="sec-head"><h2>${h(m.label)} (${list.length})</h2><button class="btn ghost sm" type="button" data-metric="${F}">${ic("x", 14)}Limpar filtro</button></div>${list.length ? `<div class="card-grid">${list.map(j => A.jobCard(j, c)).join("")}</div>` : `<div class="card card-body small muted">Nenhuma obra nesta situação.</div>`}</section>`;
      }
    }
    // A. Equipe de hoje
    const actives = (c.installers || []).filter(i => i.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    html += `<section class="card"><div class="card-head"><h2 class="h-section row">${ic("hard-hat", 16)} Equipe de hoje</h2><span class="small muted">${A.longDay(c.today)}</span></div>
      ${actives.length ? `<div>${actives.map(i => teamRow(i, statuses[i.id], c)).join("")}</div>` : `<div class="card-body">${A.emptyHTML("hard-hat", "Nenhum instalador cadastrado", "Cadastre a equipe em “Instaladores”.")}</div>`}</section>`;
    // B. upcoming + C. alerts
    const upcoming = c.jobs.filter(j => open(j) && j.status !== "rascunho" && (j.agenda || {}).inicio && j.agenda.inicio >= c.today && j.status !== "andamento").sort(byStart).slice(0, 10);
    const conflicts = C.validateAll(c);
    const alerts = A.activeAlerts(c);
    const dis = (S.alertState && S.alertState.dispensados) || {};
    const sugs = C.buildSuggestions(c).filter(s => !dis["sug:" + s.key]).slice(0, 8);
    html += `<div class="grid-2">
      <section class="card"><div class="card-head"><h2 class="h-section row">${ic("calendar-check", 16)} Próximas obras</h2><a class="btn ghost sm" href="#agenda">Agenda semanal ${ic("chevron-right", 14)}</a></div>
        ${upcoming.length ? `<div class="rows">${upcoming.map(j => upcomingRow(j, c, conflicts[j.id])).join("")}</div>` : `<div class="card-body small muted">Nenhuma obra agendada a partir de hoje.</div>`}</section>
      <div class="stack">
        <section class="card"><div class="card-head"><h2 class="h-section row">${ic("triangle-alert", 16)} Alertas operacionais</h2><span class="small muted">${alerts.length}</span></div>
          ${alerts.length ? `<div class="rows">${alerts.slice(0, 10).map(A.alertRow).join("")}</div>${alerts.length > 10 ? `<div class="card-body tiny muted">+${alerts.length - 10} no sino de alertas.</div>` : ""}` : `<div class="card-body small muted">${ic("circle-check", 15)} Nada precisa de atenção agora.</div>`}</section>
        <section class="card"><div class="card-head"><h2 class="h-section row">${ic("lightbulb", 16)} Sugestões de otimização</h2></div>
          ${sugs.length ? `<div class="rows">${sugs.map(s => sugRow(s)).join("")}</div>` : `<div class="card-body small muted">Sem sugestões no momento. Elas aparecem quando os dados mostram uma melhoria concreta.</div>`}</section>
      </div></div>`;
    el.innerHTML = html + `</div>`;
  };
  function byStart(a, b) { return String((a.agenda || {}).inicio || "9999").localeCompare(String((b.agenda || {}).inicio || "9999")) || ((C.PRIORITY[a.prio] || { n: 3 }).n - (C.PRIORITY[b.prio] || { n: 3 }).n); }
  function teamRow(i, st, c) {
    const job = st.jobId && c.jobsById[st.jobId];
    const al = job ? C.allocate(job, c) : null;
    const todayBlk = al ? al.blocks.find(b => b.date === c.today) : null;
    const last = st.lastEvent;
    const conf = st.confirmed ? `Check-in ${C.fmtTs(st.since).split(" às ")[1] ? "às " + C.fmtTs(st.since).split(" às ")[1] : ""}${C.tsParts(st.since).date !== c.today ? " de " + C.fmtDate(C.tsParts(st.since).date) : ""}` : (last ? `Última atualização: ${C.fmtTs(last.at)}` : "Sem check-in");
    return `<div class="team-row">
      <div class="row" style="gap:10px"><span class="avatar">${h(A.initials(i.nome))}</span><div class="stack" style="gap:2px"><b class="small">${h(i.nome)}</b>${badge(st.tone, st.label, true)}</div></div>
      <div class="tr-job stack" style="gap:2px">${job ? `<button type="button" class="btn ghost sm" style="justify-content:flex-start;padding:0;min-height:0;height:auto" data-open="${h(job.id)}"><b>${h(job.cliente)}</b></button><span class="tiny muted">${h([job.endereco && job.endereco.bairro, job.tipo === "manutencao" ? "Manutenção" : A.matsLabel(job).split(" · ")[0]].filter(Boolean).join(" · "))}</span>` : `<span class="small muted">${st.code === "indisponivel" ? h(st.motivo || st.label) : "Sem obra hoje"}</span>`}</div>
      <div class="tr-extra stack" style="gap:2px"><span class="tiny">${todayBlk ? `${C.fromMin(todayBlk.start)}–${C.fromMin(todayBlk.end)}` : "—"}</span><span class="tiny muted">${al && al.fim ? "Término " + C.fmtDate(al.fim) : ""}</span></div>
      <div class="stack" style="gap:2px;align-items:flex-end"><span class="tiny ${st.confirmed ? "" : "muted"}">${h(conf)}</span><span class="tiny muted">${st.confirmed ? "Confirmado pelo instalador" : "Localização não confirmada"}</span></div></div>`;
  }
  function upcomingRow(j, c, issues) {
    const crew = A.crewLabel(j, c);
    const pr = C.PRIORITY[j.prio];
    return `<button type="button" class="rowitem" data-open="${h(j.id)}">${A.dateTile(j, c)}
      <span class="grow stack" style="gap:2px"><span class="row" style="gap:6px"><b class="small truncate">${h(j.cliente)}</b>${pr ? badge(pr.tone, pr.label) : ""}</span>
      <span class="tiny muted truncate">${h([A.relDay(j.agenda.inicio, c.today) + (j.agenda.hora ? " " + j.agenda.hora : ""), crew || "Sem instalador", j.endereco && j.endereco.bairro].filter(Boolean).join(" · "))}</span></span>
      ${issues && C.hasErrors(issues) ? badge("danger", "Conflito") : !crew ? badge("danger", "Sem instalador") : C.readiness(j, c).state === "bloqueada" ? badge("warning", "Não pronta") : ""}</button>`;
  }
  function sugRow(s) {
    return `<div class="rowitem" style="cursor:default"><span class="ic si-accent">${ic("lightbulb", 16)}</span><span class="grow small">${h(s.texto)}</span>
      <span class="row" style="gap:4px">${A.canEdit ? `<button class="btn sm" type="button" data-sug-ok="${h(s.key)}">Aplicar</button>` : ""}<button class="btn ghost icon sm" type="button" data-dismiss="sug:${h(s.key)}" title="Dispensar" aria-label="Dispensar sugestão">${ic("x", 14)}</button></span></div>`;
  }
  async function applySuggestion(key) {
    const c = A.getCtx(), s = C.buildSuggestions(c).find(x => x.key === key);
    if (!s) return;
    const job = c.jobsById[s.jobId];
    if (s.tipo === "antecipar") return A.moveDialog(job.id, { date: s.data });
    if ((s.tipo === "atribuir" || s.tipo === "conflito") && s.unit) {
      const probe = { ...job, equipeId: s.unit.kind === "equipe" ? s.unit.id : null, instaladorIds: s.unit.kind === "equipe" ? [] : s.unit.members, agenda: { ...(job.agenda || {}), inicio: (job.agenda || {}).inicio && s.tipo === "atribuir" && (job.agenda || {}).inicio === s.data ? job.agenda.inicio : s.data } };
      const issues = C.validateJob(probe, c);
      if (C.hasErrors(issues)) return A.moveDialog(job.id, { date: s.data, inst: s.unit.members[0] });
      if (!(await A.confirmDialog(`Atribuir ${s.unit.kind === "equipe" ? "a equipe" : ""} ${A.instName(s.unit.members[0])}${s.unit.members.length > 1 && s.unit.kind !== "equipe" ? " e outros" : ""} a ${job.cliente} em ${C.fmtDate(probe.agenda.inicio)}?`, "Aplicar sugestão"))) return;
      await A.guard(() => Store.saveJob(job.id, { equipeId: probe.equipeId, instaladorIds: probe.instaladorIds, agenda: probe.agenda, status: job.status === "rascunho" ? "agendada" : job.status, hist: [...(job.hist || []), { t: new Date().toISOString(), txt: "Sugestão de otimização aplicada: " + s.texto }].slice(-40) }), "Sugestão aplicada.");
      return;
    }
    A.openJob(job.id);
  }
  function migrationBanner() {
    return `<div class="banner tone-warning">${ic("info", 18)}<div class="stack tight grow"><b>Atualização de dados disponível</b><span class="small">As obras da agenda antiga estão sendo exibidas como prévia, sem edição. A atualização cria os perfis dos instaladores, organiza materiais e quantidades e guarda uma cópia de segurança antes de qualquer mudança.</span>
      ${S.role === "admin" ? `<div><button class="btn primary sm" type="button" data-migrate>${ic("rotate-ccw-clock", 15)}Revisar e atualizar dados</button></div>` : `<span class="small">Peça ao administrador (dono da página) para executar a atualização.</span>`}</div></div>`;
  }
  A.migrationBanner = migrationBanner;

  /* =========================== INSTALAÇÕES / MANUTENÇÕES =========================== */
  function listView(tipo) {
    return function (el, opts) {
      const st = ui.list[tipo];
      const man = tipo === "manutencao";
      if (opts.routeChanged || !$("#lstOut", el)) {
        el.innerHTML = `<div class="stack loose">${A.getCtx().virtual ? migrationBanner() : ""}
          <div class="page-head"><div><h2 class="h-title">${man ? "Manutenções" : "Instalações"}</h2><p>${man ? "Retornos para retirar e recolocar peças, liberar acesso a encanamento ou elétrica e outros reparos." : "Todas as obras de instalação, organizadas por situação ou por instalador."}</p></div>
            ${A.canEdit ? `<button class="btn primary" type="button" data-new-tipo="${tipo}">${ic("plus", 16)}${man ? "Nova manutenção" : "Nova obra"}</button>` : ""}</div>
          <div class="card pad row wrap" style="padding:11px;gap:9px">
            <div class="segmented" role="group" aria-label="Organizar por"><button type="button" data-lview="status">Por situação</button><button type="button" data-lview="instalador">Por instalador</button></div>
            <select class="select sm" id="lstInst" aria-label="Instalador" style="width:auto;min-width:180px"></select>
            <div class="input-icon grow" style="min-width:200px">${ic("search", 16)}<input class="input sm" type="search" id="lstQ" placeholder="Buscar cliente, material, bairro…" aria-label="Buscar" value="${h(st.q)}"></div>
            <button type="button" class="chip" id="lstDone">Mostrar concluídas</button></div>
          <div id="lstOut" class="stack loose"></div></div>`;
        $("#lstQ", el).addEventListener("input", e => { st.q = e.target.value; update(); });
        $("#lstInst", el).addEventListener("change", e => { st.inst = e.target.value; update(); });
        $("#lstDone", el).addEventListener("click", () => { st.done = !st.done; update(); });
        $$("[data-lview]", el).forEach(b => b.addEventListener("click", () => { st.view = b.dataset.lview; update(); }));
      }
      update();
      function update() {
        const c = A.getCtx();
        $$("[data-lview]", el).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lview === st.view)));
        $("#lstDone", el).setAttribute("aria-pressed", String(st.done));
        const sel = $("#lstInst", el);
        sel.innerHTML = `<option value="">Todos os instaladores</option>${(c.installers || []).map(i => `<option value="${h(i.id)}">${h(i.nome)}</option>`).join("")}<option value="__none">Sem instalador</option>`;
        sel.value = [...sel.options].some(o => o.value === st.inst) ? st.inst : "";
        const q = C.norm(st.q);
        const items = c.jobs.filter(j => (j.tipo || "instalacao") === tipo && j.status !== "cancelada" && (st.done || j.status !== "concluida")
          && (!st.inst || (st.inst === "__none" ? !(j._members || []).length : (j._members || []).includes(st.inst)))
          && (!q || C.norm([j.cliente, j.servico, A.matsLabel(j), j.endereco && j.endereco.bairro, j.endereco && j.endereco.completo, A.crewLabel(j, c), j.obs].join(" ")).includes(q))).sort(byStart);
        const out = $("#lstOut", el);
        const all = c.jobs.filter(j => (j.tipo || "instalacao") === tipo);
        if (!all.length) { out.innerHTML = `<div class="card">${A.emptyHTML(man ? "wrench" : "hammer", man ? "Nenhuma manutenção cadastrada" : "Nenhuma obra cadastrada", man ? "Registre aqui os retornos para retirar e recolocar peças e outros reparos." : "Cadastre a primeira com o cliente, o material e a data prevista.", man ? "Cadastrar manutenção" : "Cadastrar obra")}</div>`; return; }
        if (!items.length) { out.innerHTML = `<div class="card">${A.emptyHTML("search", "Nenhuma obra encontrada", "Mude a busca ou o filtro de instalador.")}</div>`; return; }
        const group = (t, list) => list.length ? `<section class="stack"><div class="row"><h3 class="eyebrow">${h(t)}</h3>${badge("neutral", String(list.length))}</div><div class="card-grid">${list.map(j => A.jobCard(j, c)).join("")}</div></section>` : "";
        let html = "";
        if (st.view === "status") {
          const fl = j => C.jobFlags(j, c);
          html += group("Rascunhos", items.filter(j => j.status === "rascunho"));
          html += group("Em andamento", items.filter(j => j.status === "andamento"));
          html += group("Início atrasado", items.filter(j => fl(j).atrasada));
          html += group("Aguardando confirmação", items.filter(j => j.status === "aguardando" && !fl(j).atrasada));
          html += group("Para marcar data", items.filter(j => j.status === "agendada" && !(j.agenda || {}).inicio).sort((a, b) => ((C.PRIORITY[a.prio] || { n: 3 }).n - (C.PRIORITY[b.prio] || { n: 3 }).n)));
          html += group("Próximas", items.filter(j => j.status === "agendada" && (j.agenda || {}).inicio && !fl(j).atrasada));
          html += group("Pausadas", items.filter(j => j.status === "pausada"));
          html += group("Concluídas", items.filter(j => j.status === "concluida").reverse());
        } else {
          const keys = [...new Set(items.flatMap(j => (j._members || []).length ? j._members : [""]))].sort((a, b) => !a ? 1 : !b ? -1 : A.instName(a).localeCompare(A.instName(b), "pt-BR"));
          for (const k of keys) html += group(k ? A.instName(k) : "Sem instalador", items.filter(j => k ? (j._members || []).includes(k) : !(j._members || []).length));
        }
        out.innerHTML = html;
      }
    };
  }
  A.views.instalacoes = listView("instalacao");
  A.views.manutencoes = listView("manutencao");

  /* =========================== AGENDA SEMANAL =========================== */
  function displayIndex(c, fromDate, toDate) {
    const idx = {}, unassigned = {};
    for (const j of c.jobs) {
      if (j.status === "cancelada") continue;
      if (j.status === "rascunho" && !(j.agenda || {}).inicio) continue;
      const blocks = j.status === "andamento" ? C.occupyingBlocks(j, c) : C.allocate(j, c).blocks;
      for (const b of blocks) {
        if (b.date < fromDate || b.date > toDate) continue;
        const ms = j._members || [];
        if (!ms.length) (unassigned[b.date] = unassigned[b.date] || []).push({ j, b });
        for (const m of ms) ((idx[m] = idx[m] || {})[b.date] = idx[m][b.date] || []).push({ j, b });
      }
    }
    return { idx, unassigned };
  }
  function blkHTML(j, b, conflictIds, opts) {
    const cls = `blk s-${j.status}${conflictIds.has(j.id) ? " conflict" : ""}`;
    const drag = A.canEdit && !A.getCtx().virtual && !A.isMobile() && ["agendada", "aguardando", "rascunho", "pausada"].includes(j.status);
    const pr = C.PRIORITY[j.prio];
    return `<button type="button" class="${cls}" data-open="${h(j.id)}" ${drag ? `draggable="true" data-drag="${h(j.id)}"` : ""} title="${h(j.cliente)} — ${h((C.STATUS[j.status] || {}).label)}${conflictIds.has(j.id) ? " — conflito" : ""}" ${opts && opts.style ? `style="${opts.style}"` : ""}>
      <b>${pr && j.prio === "alta" ? "● " : ""}${h(j.cliente)}</b><small>${h([C.fromMin(b.start) + "–" + C.fromMin(b.end), j.endereco && j.endereco.bairro, j.tipo === "manutencao" ? "Manutenção" : (C.MAT[(j.itens || [])[0] && j.itens[0].mat] || {}).label].filter(Boolean).join(" · "))}</small></button>`;
  }
  A.views.agenda = function (el, opts) {
    const st = ui.agenda;
    if (!st.view) st.view = A.isMobile() ? "dia" : "semana";
    if (!st.date) st.date = C.today();
    if (opts.routeChanged || !$("#agOut", el)) {
      el.innerHTML = `<div class="stack">
        <div class="row between wrap" style="gap:10px">
          <div class="segmented" role="group" aria-label="Visualização"><button type="button" data-agv="dia">Dia</button><button type="button" data-agv="semana">Semana</button><button type="button" data-agv="mes">Mês</button></div>
          <div class="row"><button class="btn icon sm" type="button" data-agnav="-1" aria-label="Anterior">${ic("chevron-left", 16)}</button><button class="btn sm" type="button" data-agnav="0">Hoje</button><button class="btn icon sm" type="button" data-agnav="1" aria-label="Próximo">${ic("chevron-right", 16)}</button><input class="input sm" type="date" id="agDate" aria-label="Data" style="width:auto"></div></div>
        <div class="card pad row wrap" style="padding:10px;gap:8px">
          <select class="select sm" id="agInst" aria-label="Instalador" style="width:auto"></select>
          <select class="select sm" id="agTeam" aria-label="Equipe" style="width:auto"></select>
          <select class="select sm" id="agMat" aria-label="Material" style="width:auto"><option value="">Todos os materiais</option>${C.MATERIALS.map(m => `<option value="${m.id}">${h(m.label)}</option>`).join("")}</select>
          <select class="select sm" id="agTipo" aria-label="Tipo" style="width:auto"><option value="">Instalações e manutenções</option><option value="instalacao">Só instalações</option><option value="manutencao">Só manutenções</option></select>
          <span class="grow"></span><span class="tiny muted desktop-only">${A.canEdit ? "Arraste uma obra para outro dia ou instalador. Clique num espaço livre para criar uma obra." : ""}</span></div>
        <div class="row wrap tiny muted" style="gap:12px">${[["info", "Agendada"], ["warning", "Em andamento"], ["success", "Concluída"], ["danger", "Conflito ou atraso"], ["pause", "Pausada"], ["accent", "Aguardando confirmação"]].map(([t, l]) => `<span class="row" style="gap:5px"><span style="width:10px;height:10px;border-radius:3px;background:var(--${t === "pause" ? "pause" : t === "accent" ? "accent" : t})"></span>${l}</span>`).join("")}<span class="row" style="gap:5px"><span style="width:14px;height:10px;border-radius:3px;background:var(--unavail);border:1px solid var(--border)"></span>Indisponível</span></div>
        <div id="agOut"></div></div>`;
      ["#agInst", "#agTeam", "#agMat", "#agTipo"].forEach(s => $(s, el).addEventListener("change", e => { st[{ "#agInst": "inst", "#agTeam": "team", "#agMat": "mat", "#agTipo": "tipo" }[s]] = e.target.value; draw(); }));
      $("#agDate", el).addEventListener("change", e => { if (e.target.value) { st.date = e.target.value; draw(); } });
    }
    draw();
    function draw() {
      const c = A.getCtx();
      $$("[data-agv]", el).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.agv === st.view)));
      $("#agDate", el).value = st.date;
      $("#agInst", el).innerHTML = `<option value="">Todos os instaladores</option>${(c.installers || []).filter(i => i.ativo !== false).map(i => `<option value="${h(i.id)}" ${st.inst === i.id ? "selected" : ""}>${h(i.nome)}</option>`).join("")}`;
      $("#agTeam", el).innerHTML = `<option value="">Todas as equipes</option>${(c.teams || []).map(t => `<option value="${h(t.id)}" ${st.team === t.id ? "selected" : ""}>${h(t.nome)}</option>`).join("")}`;
      $("#agMat", el).value = st.mat; $("#agTipo", el).value = st.tipo;
      const team = st.team && (c.teams || []).find(t => t.id === st.team);
      const rows = (c.installers || []).filter(i => i.ativo !== false && (!st.inst || i.id === st.inst) && (!team || team.membros.includes(i.id))).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const jobOk = j => (!st.mat || (j.itens || []).some(i => i.mat === st.mat)) && (!st.tipo || (j.tipo || "instalacao") === st.tipo) && (!team || j.equipeId === team.id || (j._members || []).some(m => team.membros.includes(m)));
      const conflictIds = new Set(Object.entries(C.validateAll(c)).filter(([, v]) => C.hasErrors(v)).map(([k]) => k));
      for (const j of c.jobs) { const f = C.jobFlags(j, c); if (f.atrasada || f.excedeu) conflictIds.add(j.id); }
      const out = $("#agOut", el);
      if (!rows.length && !(c.installers || []).length) { out.innerHTML = `<div class="card">${A.emptyHTML("hard-hat", "Cadastre os instaladores primeiro", "A agenda semanal mostra uma linha por instalador.")}</div>`; return; }
      if (st.view === "semana") {
        const ws = C.weekStart(st.date), days = [...Array(7)].map((_, i) => C.addDays(ws, i));
        const { idx, unassigned } = displayIndex(c, days[0], days[6]);
        if (A.isMobile()) { out.innerHTML = weekMobile(c, rows, days, idx, unassigned, jobOk, conflictIds); return; }
        let g = `<div class="board-wrap"><div class="board" style="grid-template-columns:200px repeat(7,minmax(120px,1fr))"><div class="corner tiny muted">Semana ${C.fmtDate(days[0])} – ${C.fmtDate(days[6])}</div>`;
        g += days.map(d => `<div class="bh${d === c.today ? " today" : ""}">${h(A.shortDay(d))}${C.companyDay(c.cfg, d) ? "" : ` <span class="tiny muted">${(c.cfg.holidays || []).some(x => x.date === d) ? "feriado" : "sem expediente"}</span>`}</div>`).join("");
        for (const i of rows) {
          const wl = C.workload(i, c, days[0], 7);
          g += `<div class="rh"><div class="row" style="gap:8px"><span class="avatar">${h(A.initials(i.nome))}</span><b class="small truncate">${h(i.nome)}</b></div><div class="progress ${wl.level}" title="${wl.pct}% da capacidade da semana"><span style="width:${Math.min(100, wl.pct)}%"></span></div><span class="tiny muted">${C.fmtNum(wl.ocupadoH)} h de ${C.fmtNum(wl.capacidadeH)} h · ${wl.pct}%</span></div>`;
          for (const d of days) g += cellHTML(c, i, d, (idx[i.id] || {})[d] || [], jobOk, conflictIds);
        }
        const un = days.map(d => (unassigned[d] || []).filter(x => jobOk(x.j)));
        if (un.some(x => x.length)) {
          g += `<div class="rh"><b class="small" style="color:var(--danger-text)">Sem instalador</b><span class="tiny muted">Arraste para um instalador</span></div>`;
          g += un.map((list, k) => `<div class="cell" data-cell-un="${days[k]}">${list.map(x => blkHTML(x.j, x.b, conflictIds)).join("")}</div>`).join("");
        }
        out.innerHTML = g + `</div></div>`;
        bindDnD(out);
      } else if (st.view === "dia") {
        const d = st.date, { idx, unassigned } = displayIndex(c, d, d);
        const s0 = 7 * 60, s1 = 19 * 60, pct = m => ((m - s0) / (s1 - s0)) * 100;
        let html = `<div class="stack"><div class="sec-head"><h2>${h(A.longDay(d))} ${d === c.today ? badge("accent", "Hoje") : ""}</h2>${C.companyDay(c.cfg, d) ? "" : badge("neutral", "Sem expediente da empresa")}</div><div class="card">`;
        for (const i of rows) {
          const list = ((idx[i.id] || {})[d] || []).filter(x => jobOk(x.j));
          const day = C.installerDay(i, c.cfg, d), blk = C.blockedOn(i, d);
          html += `<div class="team-row day-row"><div class="row" style="gap:8px"><span class="avatar">${h(A.initials(i.nome))}</span><b class="small">${h(i.nome)}</b></div>
            <div class="dayline" style="${!day || blk ? "background:var(--unavail)" : ""}">${[8, 10, 12, 14, 16, 18].map(hh => `<span class="hr" style="left:${pct(hh * 60)}%">${hh}h</span>`).join("")}
              ${!day || blk ? `<span class="offlabel" style="position:absolute;left:8px;top:18px">${h(blk ? (blk.motivo || blk.tipo) : "Folga")}</span>` : ""}
              ${list.map(x => blkHTML(x.j, x.b, conflictIds, { style: `left:${pct(x.b.start)}%;width:${Math.max(6, pct(x.b.end) - pct(x.b.start))}%` })).join("")}
              ${day && !blk && A.canEdit && !list.length ? `<button class="btn ghost sm" type="button" data-newslot="${h(i.id)}|${d}" style="position:absolute;right:6px;top:12px">${ic("plus", 14)}Livre — criar obra</button>` : ""}</div></div>`;
        }
        const un = (unassigned[d] || []).filter(x => jobOk(x.j));
        if (un.length) html += `<div class="team-row day-row"><b class="small" style="color:var(--danger-text)">Sem instalador</b><div class="row wrap">${un.map(x => `<span style="width:200px">${blkHTML(x.j, x.b, conflictIds)}</span>`).join("")}</div></div>`;
        out.innerHTML = html + `</div></div>`;
      } else {
        const first = st.date.slice(0, 8) + "01", gridStart = C.weekStart(first);
        const days = [...Array(42)].map((_, i) => C.addDays(gridStart, i));
        const { idx, unassigned } = displayIndex(c, days[0], days[41]);
        const per = {};
        for (const [iid, byDate] of Object.entries(idx)) { if (!rows.some(r => r.id === iid)) continue; for (const [d, list] of Object.entries(byDate)) for (const x of list) if (jobOk(x.j)) (per[d] = per[d] || new Map()).set(x.j.id, x.j); }
        for (const [d, list] of Object.entries(unassigned)) for (const x of list) if (jobOk(x.j) && !st.inst && !team) (per[d] = per[d] || new Map()).set(x.j.id, x.j);
        out.innerHTML = `<div class="month">${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(d => `<div class="tiny muted strong" style="padding:0 4px">${d}</div>`).join("")}${days.map(d => { const list = [...(per[d] || new Map()).values()]; return `<button type="button" class="mday${d.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${d === c.today ? " today" : ""}" data-gotoday="${d}"><span class="row between"><b class="small">${+d.slice(8)}</b>${list.length ? badge("neutral", String(list.length)) : ""}</span>${list.slice(0, 3).map(j => `<span class="pill" style="border-left-color:var(--${conflictIds.has(j.id) ? "danger" : j.status === "andamento" ? "warning" : j.status === "concluida" ? "success" : j.status === "pausada" ? "pause" : "info"})">${h(j.cliente)}</span>`).join("")}${list.length > 3 ? `<span class="tiny muted">+${list.length - 3}</span>` : ""}</button>`; }).join("")}</div>`;
      }
    }
  };
  function cellHTML(c, inst, d, list, jobOk, conflictIds) {
    const day = C.installerDay(inst, c.cfg, d), blk = C.blockedOn(inst, d);
    list = list.filter(x => jobOk(x.j));
    if (!day || blk) return `<div class="cell off" data-cell="${h(inst.id)}|${d}"><span class="offlabel">${h(blk ? (blk.motivo || { ferias: "Férias", folga: "Folga", indisponivel: "Indisponível" }[blk.tipo] || "Indisponível") : (c.cfg.holidays || []).some(x => x.date === d) ? "Feriado" : "Folga")}</span>${list.map(x => blkHTML(x.j, x.b, conflictIds)).join("")}</div>`;
    const used = ((c.occ[inst.id] || {})[d] || []).reduce((s, b) => s + (b.end - b.start), 0), cap = C.capacityMin(day) + (day.breakMin || 0);
    const pct = cap ? Math.round((used / cap) * 100) : 0;
    return `<div class="cell${A.canEdit && pct < 70 ? " free" : ""}" data-cell="${h(inst.id)}|${d}" ${A.canEdit && pct < 70 ? `title="Clique para criar uma obra para ${h(inst.nome)} em ${C.fmtDate(d)}"` : ""}>${list.map(x => blkHTML(x.j, x.b, conflictIds)).join("")}${!list.length ? `<span class="tiny faint">Livre</span>` : ""}<div class="cap"><span class="${pct > 100 ? "over" : pct >= 85 ? "full" : ""}" style="width:${Math.min(100, pct)}%"></span></div></div>`;
  }
  function weekMobile(c, rows, days, idx, unassigned, jobOk, conflictIds) {
    let html = `<div class="stack">`;
    for (const i of rows) {
      const wl = C.workload(i, c, days[0], 7);
      html += `<section class="card"><div class="card-head"><div class="row" style="gap:8px"><span class="avatar">${h(A.initials(i.nome))}</span><b>${h(i.nome)}</b></div><span class="tiny muted">${wl.pct}% da semana</span></div><div class="rows">`;
      for (const d of days) {
        const list = ((idx[i.id] || {})[d] || []).filter(x => jobOk(x.j));
        const day = C.installerDay(i, c.cfg, d), blk = C.blockedOn(i, d);
        html += `<div class="rowitem" style="cursor:default;align-items:flex-start${!day || blk ? ";background:var(--unavail)" : ""}"><span class="small strong" style="width:62px;flex:none">${h(A.shortDay(d))}</span><span class="grow stack tight">${list.map(x => blkHTML(x.j, x.b, conflictIds)).join("") || (!day || blk ? `<span class="tiny muted">${h(blk ? (blk.motivo || blk.tipo) : "Folga")}</span>` : A.canEdit ? `<button class="btn ghost sm" type="button" data-newslot="${h(i.id)}|${d}" style="justify-content:flex-start">${ic("plus", 14)}Livre — criar obra</button>` : `<span class="tiny faint">Livre</span>`)}</span></div>`;
      }
      html += `</div></section>`;
    }
    const un = days.flatMap(d => (unassigned[d] || []).filter(x => jobOk(x.j)).map(x => ({ ...x, d })));
    if (un.length) html += `<section class="card"><div class="card-head"><b style="color:var(--danger-text)">Sem instalador</b></div><div class="card-body stack tight">${un.map(x => blkHTML(x.j, x.b, conflictIds)).join("")}</div></section>`;
    return html + `</div>`;
  }
  function bindDnD(root) {
    root.addEventListener("dragstart", e => { const b = e.target.closest("[data-drag]"); if (!b) return; e.dataTransfer.setData("text/plain", b.dataset.drag); e.dataTransfer.effectAllowed = "move"; b.classList.add("dragging"); });
    root.addEventListener("dragend", e => { const b = e.target.closest("[data-drag]"); if (b) b.classList.remove("dragging"); $$(".cell.drop", root).forEach(x => x.classList.remove("drop")); });
    root.addEventListener("dragover", e => { const cell = e.target.closest("[data-cell],[data-cell-un]"); if (!cell) return; e.preventDefault(); $$(".cell.drop", root).forEach(x => x !== cell && x.classList.remove("drop")); cell.classList.add("drop"); });
    root.addEventListener("drop", e => {
      const cell = e.target.closest("[data-cell],[data-cell-un]"); if (!cell) return;
      e.preventDefault(); cell.classList.remove("drop");
      const id = e.dataTransfer.getData("text/plain");
      if (cell.dataset.cellUn) return A.moveDialog(id, { date: cell.dataset.cellUn });
      const [inst, date] = cell.dataset.cell.split("|");
      A.moveDialog(id, { date, inst });
    });
  }

  /* =========================== MAPA DE OBRAS =========================== */
  const MANAUS = { latMin: -3.16, latMax: -2.94, lngMin: -60.11, lngMax: -59.90 };
  A.views.mapa = function (el) {
    const c = A.getCtx(), st = ui.mapa;
    const end = st.range === "hoje" ? c.today : st.range === "semana" ? C.addDays(c.today, 6) : "9999-12-31";
    const jobs = c.jobs.filter(j => {
      if (j.status === "cancelada" || (st.range !== "todas" && j.status === "concluida")) return false;
      if (st.status && j.status !== st.status) return false;
      if (st.inst && !(j._members || []).includes(st.inst)) return false;
      if (st.range === "todas") return true;
      const al = C.allocate(j, c);
      return j.status === "andamento" || al.blocks.some(b => b.date >= c.today && b.date <= end) || (j.agenda && j.agenda.inicio && j.agenda.inicio >= c.today && j.agenda.inicio <= end);
    });
    const located = jobs.filter(j => C.hasCoords(j.endereco)), missing = jobs.filter(j => !C.hasCoords(j.endereco));
    const bb = { ...MANAUS };
    for (const j of located) { bb.latMin = Math.min(bb.latMin, j.endereco.lat - .01); bb.latMax = Math.max(bb.latMax, j.endereco.lat + .01); bb.lngMin = Math.min(bb.lngMin, j.endereco.lng - .01); bb.lngMax = Math.max(bb.lngMax, j.endereco.lng + .01); }
    const W = 900, kx = Math.cos((bb.latMin + bb.latMax) / 2 * Math.PI / 180), Hh = Math.round(W * (bb.latMax - bb.latMin) / ((bb.lngMax - bb.lngMin) * kx));
    const X = lng => ((lng - bb.lngMin) / (bb.lngMax - bb.lngMin)) * W, Y = lat => ((bb.latMax - lat) / (bb.latMax - bb.latMin)) * Hh;
    const color = j => ({ andamento: "var(--warning)", concluida: "var(--success)", pausada: "var(--pause)", aguardando: "var(--accent)" }[j.status] || (C.jobFlags(j, c).atrasada ? "var(--danger)" : "var(--info)"));
    const kmPerX = ((bb.lngMax - bb.lngMin) * 111.32 * kx) / W;
    const bar = 2 / kmPerX;
    el.innerHTML = `<div class="stack">
      <div class="page-head"><div><h2 class="h-title">Mapa de Obras</h2><p>Posição real de cada obra a partir das coordenadas cadastradas. O mapa de ruas, a busca de endereço e o tempo de trajeto dependem de um serviço de mapas externo que ainda não está configurado; por isso as obras aparecem sobre uma grade, e as distâncias são em linha reta.</p></div></div>
      <div class="card pad row wrap" style="padding:10px;gap:8px">
        <div class="segmented" role="group" aria-label="Período"><button type="button" data-mr="hoje" aria-pressed="${st.range === "hoje"}">Hoje</button><button type="button" data-mr="semana" aria-pressed="${st.range === "semana"}">Esta semana</button><button type="button" data-mr="todas" aria-pressed="${st.range === "todas"}">Todas</button></div>
        <select class="select sm" id="mpInst" style="width:auto" aria-label="Instalador"><option value="">Todos os instaladores</option>${(c.installers || []).map(i => `<option value="${h(i.id)}" ${st.inst === i.id ? "selected" : ""}>${h(i.nome)}</option>`).join("")}</select>
        <select class="select sm" id="mpSt" style="width:auto" aria-label="Situação"><option value="">Todas as situações</option>${Object.entries(C.STATUS).filter(([k]) => k !== "cancelada").map(([k, v]) => `<option value="${k}" ${st.status === k ? "selected" : ""}>${h(v.label)}</option>`).join("")}</select>
        <span class="small muted">${located.length} no mapa · ${missing.length} sem localização</span></div>
      <div class="grid-2">
        <div class="mapbox"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Posição das obras em Manaus">
          <rect width="${W}" height="${Hh}" fill="var(--surface-2)"/>
          ${[...Array(9)].map((_, k) => `<line x1="${(k + 1) * W / 10}" y1="0" x2="${(k + 1) * W / 10}" y2="${Hh}" stroke="var(--border)" stroke-width="1"/>`).join("")}${[...Array(9)].map((_, k) => `<line x1="0" y1="${(k + 1) * Hh / 10}" x2="${W}" y2="${(k + 1) * Hh / 10}" stroke="var(--border)" stroke-width="1"/>`).join("")}
          <g transform="translate(${W - 40},34)"><path d="M0 -18 L7 6 L0 0 L-7 6 Z" fill="var(--text-2)"/><text y="22" text-anchor="middle" font-size="13" fill="var(--text-2)">N</text></g>
          <g transform="translate(20,${Hh - 20})"><line x1="0" y1="0" x2="${bar}" y2="0" stroke="var(--text-2)" stroke-width="3"/><text x="${bar / 2}" y="-7" text-anchor="middle" font-size="12" fill="var(--text-2)">2 km</text></g>
          ${located.map(j => `<g class="pin" data-open="${h(j.id)}" tabindex="0" role="button" aria-label="${h(j.cliente)}"><circle cx="${X(j.endereco.lng)}" cy="${Y(j.endereco.lat)}" r="9" fill="${color(j)}" stroke="var(--surface)" stroke-width="3"/><title>${h(j.cliente)} — ${h(A.crewLabel(j, c) || "sem instalador")} — ${h((C.STATUS[j.status] || {}).label)}${j.agenda && j.agenda.inicio ? " — " + C.fmtDate(j.agenda.inicio) : ""}</title></g>`).join("")}
          ${!located.length ? `<text x="${W / 2}" y="${Hh / 2}" text-anchor="middle" font-size="16" fill="var(--text-2)">Nenhuma obra com localização neste filtro</text>` : ""}
        </svg></div>
        <div class="stack">
          <section class="card"><div class="card-head"><h3 class="h-section">No mapa (${located.length})</h3></div><div class="rows">${located.map(j => `<button type="button" class="rowitem" data-open="${h(j.id)}"><span style="width:12px;height:12px;border-radius:50%;background:${color(j)};flex:none"></span><span class="grow stack" style="gap:1px"><b class="small">${h(j.cliente)}</b><span class="tiny muted">${h([(j.endereco || {}).completo || (j.endereco || {}).bairro, A.crewLabel(j, c) || "Sem instalador", j.agenda && j.agenda.inicio ? C.fmtDate(j.agenda.inicio) : "Sem data", A.matsLabel(j).split(" · ")[0]].filter(Boolean).join(" · "))}</span></span></button>`).join("") || `<div class="card-body small muted">—</div>`}</div></section>
          <section class="card"><div class="card-head"><h3 class="h-section">Sem localização (${missing.length})</h3></div><div class="rows">${missing.slice(0, 40).map(j => `<div class="rowitem" style="cursor:default"><span class="grow stack" style="gap:1px"><b class="small">${h(j.cliente)}</b><span class="tiny muted">${h((j.endereco || {}).completo || (j.endereco || {}).bairro || "Endereço não informado")}</span></span>${A.canEdit && !c.virtual ? `<button class="btn sm" type="button" data-setloc="${h(j.id)}">${ic("map-pin", 14)}Definir</button>` : ""}</div>`).join("") || `<div class="card-body small muted">Todas as obras do filtro têm localização.</div>`}</div></section>
        </div></div></div>`;
    $("#mpInst", el).addEventListener("change", e => { st.inst = e.target.value; A.views.mapa(el); });
    $("#mpSt", el).addEventListener("change", e => { st.status = e.target.value; A.views.mapa(el); });
  };
  function setLocation(id) {
    const c = A.getCtx(), j = c.jobsById[id], e = j.endereco || {};
    const q = encodeURIComponent([e.completo, e.bairro, c.cfg.city].filter(Boolean).join(", "));
    const d = A.openDialog({
      title: "Definir localização", sub: h(j.cliente),
      body: `<div class="stack"><ol class="small" style="margin:0;padding-left:18px"><li>${e.completo || e.bairro ? `<a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener noreferrer">Abra o endereço no Google Maps</a>` : "Abra o local no Google Maps"} e confira o ponto exato.</li><li>Copie o link da barra de endereço (ou toque e segure no ponto para copiar as coordenadas).</li><li>Cole abaixo.</li></ol>
        <div class="field"><label for="locIn">Link ou coordenadas</label><input class="input" id="locIn" placeholder="https://www.google.com/maps/@-3.10,-60.02,17z ou -3.10, -60.02"><span class="hint" id="locHint">A posição é guardada exatamente como informada; nada é estimado pelo nome do bairro.</span></div></div>`,
      foot: `<button class="btn" data-x type="button">Cancelar</button><button class="btn primary" type="button" id="locOk">Salvar localização</button>`
    });
    $("#locOk", d).addEventListener("click", async () => {
      const p = C.parseCoords($("#locIn", d).value);
      if (!p) { $("#locHint", d).textContent = "Não reconheci coordenadas neste texto."; $("#locHint", d).style.color = "var(--danger-text)"; return; }
      await A.guard(() => Store.saveJob(id, { endereco: { ...e, lat: p.lat, lng: p.lng, coordFonte: "manual" } }), p.dentroDeManaus ? "Localização salva." : "Localização salva — parece estar fora de Manaus, confira.");
      d.close();
    });
  }

  /* =========================== events =========================== */
  document.addEventListener("click", e => {
    const t = e.target; let x;
    if ((x = t.closest("[data-metric]"))) { ui.central.filter = ui.central.filter === x.dataset.metric ? null : x.dataset.metric; A.render(); return; }
    if ((x = t.closest("[data-sug-ok]"))) { applySuggestion(x.dataset.sugOk); return; }
    if ((x = t.closest("[data-new-tipo]"))) { A.openForm(null, { tipo: x.dataset.newTipo }); return; }
    if ((x = t.closest("[data-agv]"))) { ui.agenda.view = x.dataset.agv; A.render(true); return; }
    if ((x = t.closest("[data-agnav]"))) { const n = +x.dataset.agnav, v = ui.agenda.view; ui.agenda.date = n === 0 ? C.today() : v === "mes" ? C.addDays(ui.agenda.date.slice(0, 8) + "15", n * 30).slice(0, 8) + "01" : C.addDays(ui.agenda.date, n * (v === "semana" ? 7 : 1)); A.render(true); return; }
    if ((x = t.closest("[data-gotoday]"))) { ui.agenda.date = x.dataset.gotoday; ui.agenda.view = "dia"; A.render(true); return; }
    if ((x = t.closest("[data-agenda-inst]"))) { ui.agenda.inst = x.dataset.agendaInst; ui.agenda.view = "semana"; return; }
    if ((x = t.closest("[data-newslot]"))) { const [inst, d] = x.dataset.newslot.split("|"); A.openForm(null, { instaladorIds: [inst], agenda: { inicio: d, hora: "08:00" } }); return; }
    if ((x = t.closest(".cell.free")) && !t.closest(".blk")) { const [inst, d] = x.dataset.cell.split("|"); A.openForm(null, { instaladorIds: [inst], agenda: { inicio: d, hora: "08:00" } }); return; }
    if ((x = t.closest("[data-mr]"))) { ui.mapa.range = x.dataset.mr; A.render(true); return; }
    if ((x = t.closest("[data-setloc]"))) { setLocation(x.dataset.setloc); return; }
  });
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".pin[data-open]")) { e.preventDefault(); A.openJob(e.target.dataset.open); } });
  A.ui.newPreset = () => (A.route === "manutencoes" ? { tipo: "manutencao" } : null);
})();
