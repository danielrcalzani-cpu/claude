/* App shell: routing, roles, shared UI helpers, job detail panel and job actions. */
(function () {
  "use strict";
  const C = window.Core, Store = window.Store, S = Store.S;

  /* ---------------- helpers ---------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ic = (n, s) => `<svg class="lucide" width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const badge = (tone, txt, dot) => `<span class="badge tone-${tone}">${dot ? '<span class="dot" aria-hidden="true"></span>' : ""}${h(txt)}</span>`;
  const initials = n => { const p = String(n || "").trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ""))).toUpperCase() : "?"; };
  const MESC = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function longDay(d) { const { y, m, dd } = { y: d.slice(0, 4), m: +d.slice(5, 7), dd: +d.slice(8, 10) }; const s = `${C.DOW_PT[C.dow(d)]}, ${dd} de ${C.MONTH_PT[m - 1]} de ${y}`; return s[0].toUpperCase() + s.slice(1); }
  const shortDay = d => `${C.DOW_SHORT[C.dow(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const relDay = (d, t) => d === t ? "Hoje" : d === C.addDays(t, 1) ? "Amanhã" : d === C.addDays(t, -1) ? "Ontem" : shortDay(d);

  function toast(msg, isErr) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " error" : "");
    t.innerHTML = ic(isErr ? "triangle-alert" : "circle-check", 17) + `<span>${h(msg)}</span>`;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  /** Generic dialog. Returns the element; resolves `closed` when it closes. */
  function openDialog(o) {
    const d = document.createElement("dialog");
    d.className = "modal" + (o.wide ? " wide" : "") + (o.drawer ? " drawer" : "");
    d.innerHTML = `<div class="modal-head"><div class="grow"><h2>${h(o.title || "")}</h2>${o.sub ? `<div class="sub">${o.sub}</div>` : ""}</div><button type="button" class="btn ghost icon sm" data-x aria-label="Fechar">${ic("x", 18)}</button></div>
      <div class="modal-body">${o.body || ""}</div>${o.foot != null ? `<div class="modal-foot">${o.foot}</div>` : ""}`;
    document.body.appendChild(d);
    d.addEventListener("close", () => { d.remove(); o.onClose && o.onClose(); });
    d.addEventListener("click", e => { if (e.target.closest("[data-x]")) d.close(); });
    d.showModal();
    o.onMount && o.onMount(d);
    return d;
  }
  function confirmDialog(text, okLabel, danger) {
    return new Promise(res => {
      let ok = false;
      const d = openDialog({ title: "Confirmar", body: `<p>${h(text)}</p>`, foot: `<button class="btn" data-x type="button">Voltar</button><button class="btn ${danger ? "danger" : "primary"}" type="button" data-ok>${h(okLabel || "Confirmar")}</button>`, onClose: () => res(ok) });
      $("[data-ok]", d).addEventListener("click", () => { ok = true; d.close(); });
    });
  }
  async function guard(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e && e.message ? e.message : "Algo deu errado. Tente de novo.", true); throw e; }
  }

  /* ---------------- context ---------------- */
  let ctx = null, virtual = null;
  /** Before migration, legacy records are shown through an in-memory plan (read-only). */
  function getCtx() {
    if (ctx && ctx.today === C.today()) return ctx;
    const cfg = S.cfg || C.defaultConfig();
    let installers = S.installers, teams = S.teams, jobs = S.jobs.filter(j => j.v === 2);
    virtual = null;
    const legacy = S.jobs.filter(j => j.v !== 2);
    if (legacy.length) {
      const plan = C.planMigration(legacy, { installers, teams });
      virtual = plan;
      installers = installers.concat(plan.installers);
      teams = teams.concat(plan.teams);
      jobs = jobs.concat(plan.jobs.map(j => withLegacyHours({ ...j.data, id: j.id }, cfg)));
    } else jobs = jobs.map(j => withLegacyHours(j, cfg));
    ctx = C.buildContext({ cfg, installers, teams, jobs }, new Date());
    ctx.events = fieldEvents();
    ctx.virtual = !!virtual;
    return ctx;
  }
  function withLegacyHours(j, cfg) {
    if (j.agenda && !j.agenda.horas && j.agenda.fimLegado) { const hrs = C.legacyHours(j, cfg); if (hrs) return { ...j, agenda: { ...j.agenda, horas: hrs } }; }
    return j;
  }
  function fieldEvents() {
    const people = Object.fromEntries((S.acessos.pessoas || []).map(p => [p.id, p]));
    const out = [];
    for (const [uid, doc] of Object.entries(S.campo || {})) {
      const p = people[uid];
      if (!p || !p.instaladorId) continue;
      for (const e of (doc && doc.eventos) || []) out.push({ ...e, instId: p.instaladorId, por: uid, origem: "campo" });
    }
    return out;
  }
  const instName = id => { const i = getCtx().installersById[id]; return i ? i.nome : "—"; };
  const crewLabel = (job, c) => {
    c = c || getCtx();
    if (job.equipeId) { const t = (c.teams || []).find(x => x.id === job.equipeId); if (t) return t.nome; }
    const ids = job._members || C.jobMembers(job, c.teams);
    return ids.length ? ids.map(instName).join(", ") : "";
  };
  const matsLabel = job => (job.itens || []).map(i => `${i.label || (C.MAT[i.mat] || {}).label || i.mat}${i.qtd ? ` · ${C.fmtNum(i.qtd)} ${i.unidade || ""}${i.unidadeInferida ? " (unidade a confirmar)" : ""}` : ""}`).join(" + ");

  function statusBadges(job, c, opts) {
    c = c || getCtx();
    const f = C.jobFlags(job, c);
    const issues = C.validateJob(job, c);
    const st = C.STATUS[job.status] || C.STATUS.agendada;
    const out = [badge(st.tone, st.label, true)];
    if (f.atrasada) out.push(badge("danger", "Atrasada"));
    if (f.excedeu) out.push(badge("danger", "Passou do prazo"));
    if (f.iniciaHoje) out.push(badge("info", "Inicia hoje"));
    if (f.terminaHoje) out.push(badge("success", "Termina hoje"));
    if (f.semInstalador && job.status !== "rascunho") out.push(badge("danger", "Sem instalador"));
    if (C.hasErrors(issues)) out.push(badge("danger", (job.overrides || []).length ? "Conflito aceito" : "Conflito de agenda"));
    if (job.prio && C.PRIORITY[job.prio] && !["concluida", "cancelada"].includes(job.status)) out.push(badge(C.PRIORITY[job.prio].tone, C.PRIORITY[job.prio].label));
    if (!opts || !opts.noReady) {
      const rd = C.readiness(job, c);
      if (rd.state === "bloqueada") out.push(badge("danger", "Não está pronta"));
      else if (rd.state === "pendente" && job.agenda && job.agenda.inicio) out.push(badge("warning", "Prontidão pendente"));
    }
    if (job.tipo === "manutencao") out.push(badge("accent", "Manutenção"));
    return out.join("");
  }
  function dateTile(job, c) {
    const a = job.agenda || {}, f = C.jobFlags(job, c);
    if (!a.inicio) return `<div class="date-tile none"><b>s/d</b><span>sem data</span></div>`;
    const cls = f.atrasada || f.excedeu ? "late" : job.status === "andamento" ? "go" : job.status === "concluida" ? "ok" : job.status === "pausada" ? "pause" : "";
    return `<div class="date-tile ${cls}" title="Início ${C.fmtDate(a.inicio)}"><b>${a.inicio.slice(8, 10)}</b><span>${MESC[+a.inicio.slice(5, 7) - 1]}</span></div>`;
  }
  function jobCard(job, c) {
    c = c || getCtx();
    const f = C.jobFlags(job, c), a = job.agenda || {};
    const crew = crewLabel(job, c);
    const u = job.prio === "alta" && !["concluida", "cancelada"].includes(job.status) ? " u-alta" : job.prio === "media" && !["concluida", "cancelada"].includes(job.status) ? " u-media" : "";
    const when = a.inicio ? `${relDay(a.inicio, c.today)}${a.hora ? " · " + a.hora : ""}${f.fimPrevisto && f.fimPrevisto !== a.inicio ? " → " + C.fmtDate(f.fimPrevisto) : ""}` : "Sem data marcada";
    return `<article class="card jcard${u}">
      <div class="row top" style="gap:12px">${dateTile(job, c)}
        <div class="stack tight grow"><button type="button" class="customer" data-open="${h(job.id)}">${h(job.cliente)}</button>
          <div class="row wrap" style="gap:5px">${statusBadges(job, c)}</div></div></div>
      ${job.servico && job.tipo === "manutencao" ? `<div class="small"><b>Serviço:</b> ${h(job.servico)}</div>` : ""}
      ${matsLabel(job) ? `<div class="small">${h(matsLabel(job))}</div>` : ""}
      <div class="meta"><span>${ic("clock", 13)} ${h(when)}</span>
        ${crew ? `<span>${ic("user", 13)} <b>${h(crew)}</b></span>` : `<span style="color:var(--danger-text)">${ic("user-x", 13)} Sem instalador</span>`}
        ${job.endereco && job.endereco.bairro ? `<span>${ic("map-pin", 13)} ${h(job.endereco.bairro)}</span>` : ""}</div>
      ${quickActions(job, c)}
    </article>`;
  }
  function quickActions(job, c) {
    if (!App.canEdit || c.virtual) return `<div class="row"><button type="button" class="btn ghost sm" data-open="${h(job.id)}">${ic("eye", 15)}Ver detalhes</button></div>`;
    const b = [];
    if (job.status === "rascunho" || job.status === "aguardando" || (job.status === "agendada" && (!job.agenda || !job.agenda.inicio || !(job._members || []).length))) b.push(`<button type="button" class="btn primary sm" data-edit="${h(job.id)}" data-step="2">${ic("sparkles", 15)}Agendar</button>`);
    else if (job.status === "agendada") b.push(`<button type="button" class="btn accent sm" data-act="inicio" data-id="${h(job.id)}">${ic("play", 15)}Iniciar</button>`);
    else if (job.status === "andamento") b.push(`<button type="button" class="btn success sm" data-act="fim" data-id="${h(job.id)}">${ic("circle-check", 15)}Concluir</button>`);
    else if (job.status === "pausada") b.push(`<button type="button" class="btn accent sm" data-act="retomada" data-id="${h(job.id)}">${ic("play", 15)}Retomar</button>`);
    b.push(`<button type="button" class="btn ghost sm" data-open="${h(job.id)}">Detalhes</button>`);
    return `<div class="row wrap">${b.join("")}</div>`;
  }
  const emptyHTML = (icon, title, text, btn) => `<div class="empty"><div class="empty-icon">${ic(icon, 22)}</div><h3>${h(title)}</h3>${text ? `<p>${h(text)}</p>` : ""}${btn && App.canEdit ? `<button class="btn primary" type="button" data-new style="margin-top:6px">${ic("plus", 16)}${h(btn)}</button>` : ""}</div>`;
  const issueHTML = i => `<div class="issue ${i.severity === "erro" ? "tone-danger" : "tone-warning"}">${ic(i.severity === "erro" ? "ban" : "triangle-alert", 16)}<span>${h(i.msg)}</span></div>`;

  /* ---------------- job actions ---------------- */
  /** Office-side status actions go through the same event pipeline as field events. */
  async function jobAction(id, tipo, extra) {
    const c = getCtx(), job = c.jobsById[id];
    if (!job || c.virtual) return;
    if (tipo === "pausa") return pauseDialog(job);
    if (tipo === "fim") return finishDialog(job);
    if (tipo === "inicio") {
      const rd = C.readiness(job, c);
      if (rd.missing.length && !(await confirmDialog(`Ainda falta: ${rd.missing.join(", ")}. Iniciar mesmo assim?`, "Iniciar obra"))) return;
    }
    const ev = { id: Store.newId("ev"), tipo, at: new Date().toISOString(), por: S.uid, origem: "escritorio", nota: (extra && extra.nota) || "" };
    const patch = Store.applyEvents(job, [ev]);
    await guard(() => Store.saveJob(id, patch), { inicio: "Obra iniciada (registrado pelo escritório).", retomada: "Obra retomada.", a_caminho: "Registrado." }[tipo]);
  }
  function pauseDialog(job) {
    const d = openDialog({
      title: "Pausar obra", sub: h(job.cliente),
      body: `<div class="stack"><div class="field"><label for="pzCausa">Motivo da pausa *</label><select class="select" id="pzCausa"><option value="">Escolha…</option>${Object.entries(C.DELAY_CAUSES).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></div>
        <div class="field"><label for="pzNota">Detalhes</label><textarea class="textarea" id="pzNota" placeholder="Ex.: aguardando chegada do rodapé"></textarea></div><p class="small" id="pzErr" style="color:var(--danger-text)" hidden></p></div>`,
      foot: `<button class="btn" data-x type="button">Cancelar</button><button class="btn primary" type="button" id="pzOk">Pausar obra</button>`
    });
    $("#pzOk", d).addEventListener("click", async () => {
      const causa = $("#pzCausa", d).value, nota = $("#pzNota", d).value.trim();
      if (!causa) { const e = $("#pzErr", d); e.hidden = false; e.textContent = "Informe o motivo da pausa."; return; }
      const ev = { id: Store.newId("ev"), tipo: "pausa", at: new Date().toISOString(), por: S.uid, origem: "escritorio", nota: `${C.DELAY_CAUSES[causa]}${nota ? ": " + nota : ""}`, causa };
      await guard(() => Store.saveJob(job.id, { ...Store.applyEvents(job, [ev]), pausaMotivo: ev.nota }), "Obra pausada.");
      d.close();
    });
  }
  function finishDialog(job) {
    const c = getCtx(), f = C.jobFlags(job, c);
    const late = f.fimPrevisto && f.fimPrevisto < c.today;
    const d = openDialog({
      title: "Concluir obra", sub: h(job.cliente),
      body: `<div class="stack">
        ${late ? `<div class="field"><label for="fnCausa">A obra terminou depois do previsto (${C.fmtDate(f.fimPrevisto)}). Motivo *</label><select class="select" id="fnCausa"><option value="">Escolha…</option>${Object.entries(C.DELAY_CAUSES).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select><span class="hint">Usado para não contar atrasos de material ou do cliente contra o instalador.</span></div>` : ""}
        <div class="field"><label for="fnNota">Observações da conclusão</label><textarea class="textarea" id="fnNota"></textarea></div>
        <div class="field"><label for="fnPend">Pendências que ficaram</label><textarea class="textarea" id="fnPend" placeholder="Deixe em branco se não houver"></textarea><span class="hint">Com pendências, aparece um alerta para criar uma manutenção vinculada.</span></div>
        <p class="small" id="fnErr" style="color:var(--danger-text)" hidden></p></div>`,
      foot: `<button class="btn" data-x type="button">Cancelar</button><button class="btn success" type="button" id="fnOk">${ic("circle-check", 16)}Concluir obra</button>`
    });
    $("#fnOk", d).addEventListener("click", async () => {
      const causa = late ? $("#fnCausa", d).value : null;
      if (late && !causa) { const e = $("#fnErr", d); e.hidden = false; e.textContent = "Informe o motivo do atraso."; return; }
      const ev = { id: Store.newId("ev"), tipo: "fim", at: new Date().toISOString(), por: S.uid, origem: "escritorio", nota: $("#fnNota", d).value.trim(), pendencias: $("#fnPend", d).value.trim(), causa };
      $("#fnOk", d).disabled = true;
      try { await guard(() => Store.saveJob(job.id, Store.applyEvents(job, [ev])), "Obra concluída."); d.close(); } catch (e) { $("#fnOk", d).disabled = false; }
    });
  }

  /* ---------------- job detail drawer ---------------- */
  let detailDlg = null, detailId = null;
  function openJob(id) {
    detailId = id;
    if (detailDlg) { renderDetail(); return; }
    detailDlg = openDialog({ title: "", drawer: true, body: "", foot: "", onClose: () => { detailDlg = null; detailId = null; } });
    renderDetail();
  }
  function renderDetail() {
    if (!detailDlg) return;
    const c = getCtx(), job = c.jobsById[detailId];
    if (!job) { detailDlg.close(); return; }
    const f = C.jobFlags(job, c), issues = C.validateJob(job, c), rd = C.readiness(job, c), a = job.agenda || {};
    const est = C.estimateDuration(job, c);
    const tpl = C.waTemplates(job, c);
    const crewIds = job._members || [];
    const crewPhones = crewIds.map(id => c.installersById[id]).filter(i => i && i.fone);
    $(".modal-head h2", detailDlg).textContent = job.cliente || "Obra";
    $(".modal-head .grow", detailDlg).innerHTML = `<h2>${h(job.cliente)}</h2><div class="sub">${job.tipo === "manutencao" ? "Manutenção" : "Instalação"}${job.atualizado ? ` · atualizada em ${h(C.fmtTs(job.atualizado))}` : ""}</div>`;
    const canEdit = App.canEdit && !c.virtual;
    const end = job.endereco || {};
    const mapsQ = encodeURIComponent([end.completo, end.bairro, c.cfg.city].filter(Boolean).join(", "));
    const mapsUrl = C.hasCoords(end) ? `https://www.google.com/maps/search/?api=1&query=${end.lat},${end.lng}` : (end.completo || end.bairro) ? `https://www.google.com/maps/search/?api=1&query=${mapsQ}` : null;
    const info = (icon, k, v) => `<div class="row top" style="gap:10px"><span class="muted" style="margin-top:2px">${ic(icon, 16)}</span><div class="grow"><div class="tiny muted">${h(k)}</div><div class="small">${v}</div></div></div>`;
    const acts = (job.atividade || []).slice().reverse();
    $(".modal-body", detailDlg).innerHTML = `<div class="stack loose">
      <div class="row wrap" style="gap:5px">${statusBadges(job, c)}</div>
      ${c.virtual ? `<div class="banner tone-warning small">${ic("info", 16)}<span>Atualize os dados (em Configurações) para editar esta obra.</span></div>` : ""}
      <div class="row wrap">
        ${canEdit ? `<button class="btn sm" type="button" data-edit="${h(job.id)}">${ic("pen-line", 15)}Editar</button><button class="btn sm" type="button" data-move="${h(job.id)}">${ic("calendar-clock", 15)}Remarcar</button>` : ""}
        ${mapsUrl ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="${h(mapsUrl)}">${ic("navigation", 15)}Google Maps</a>` : ""}
        ${job.fone ? `<div class="bell-wrap"><button class="btn sm" type="button" data-wamenu>${ic("message-circle", 15)}WhatsApp cliente</button><div class="card popover" data-wapop hidden><div class="rows">${tpl.cliente.map(t => `<a class="rowitem" target="_blank" rel="noopener noreferrer" href="${h(C.waLink(job.fone, t.text))}">${ic("message-circle", 15)}<span class="grow small">${h(t.label)}</span></a>`).join("")}</div></div></div>` : ""}
        ${crewPhones.length ? `<div class="bell-wrap"><button class="btn sm" type="button" data-wamenu>${ic("hard-hat", 15)}WhatsApp instalador</button><div class="card popover" data-wapop hidden><div class="rows">${crewPhones.map(i => tpl.instalador.map(t => `<a class="rowitem" target="_blank" rel="noopener noreferrer" href="${h(C.waLink(i.fone, t.text))}"><span class="grow small">${h(t.label)} — ${h(i.nome)}</span></a>`).join("")).join("")}</div></div></div>` : ""}
      </div>
      ${issues.length ? `<section class="stack tight"><h3 class="h-section">Agenda e conflitos</h3>${issues.map(issueHTML).join("")}${(job.overrides || []).length ? `<p class="tiny muted">Aceito manualmente: “${h(job.overrides[job.overrides.length - 1].motivo)}”</p>` : ""}</section>` : ""}
      <section class="stack tight"><h3 class="h-section">Obra</h3><div class="card pad stack">
        ${info("map-pin", "Endereço", `${h(end.completo || "Endereço completo não informado")}${end.bairro ? `<div class="muted">${h(end.bairro)}${end.ref ? " · " + h(end.ref) : ""}</div>` : ""}${C.hasCoords(end) ? `<div class="tiny muted">Coordenadas: ${end.lat.toFixed(5)}, ${end.lng.toFixed(5)}</div>` : ""}`)}
        ${info("phone", "WhatsApp do cliente", h(job.fone || "Não informado"))}
        ${info("package", "Material", h(matsLabel(job) || "Não informado") + (job.complexidade && job.complexidade !== "normal" ? ` · ${h(C.COMPLEXITY[job.complexidade].label)}` : ""))}
        ${job.servico ? info("wrench", "Serviço", h(job.servico)) : ""}
        ${job.obs ? info("clipboard-list", "Instruções", `<span style="white-space:pre-line">${h(job.obs)}</span>`) : ""}
      </div></section>
      <section class="stack tight"><h3 class="h-section">Agendamento</h3><div class="card pad stack">
        ${info("calendar-days", "Período", a.inicio ? `${h(longDay(a.inicio))}${a.hora ? `, ${h(a.hora)}` : ""}${f.fimPrevisto ? `<div class="muted">Término previsto: ${h(C.fmtDate(f.fimPrevisto))}${f.blocks.length ? ` · ${f.blocks.length} dia(s) de trabalho` : ""}</div>` : ""}` : "Sem data")}
        ${info("clock", "Duração", a.horas ? `${C.fmtNum(a.horas)} h de trabalho${a.horasManual ? " (definida manualmente)" : ""}` : est.horas ? `${C.fmtNum(est.horas)} h estimadas (${h(origemLabel(est.origem))})` : h(est.motivo || "Sem estimativa"))}
        ${info("users", "Instalador(es)", crewIds.length ? h(crewLabel(job, c)) + (job.equipeNecessaria > 1 ? ` · precisa de ${job.equipeNecessaria}` : "") : `<span style="color:var(--danger-text)">Sem instalador</span>`)}
        ${job.real && job.real.inicio ? info("play", "Execução real", `Início ${h(C.fmtTs(job.real.inicio))}${job.real.aproximado ? " (aproximado, agenda antiga)" : ""}${job.real.fim ? `<div>Fim ${h(C.fmtTs(job.real.fim))}</div>` : ""}`) : ""}
      </div></section>
      <section class="stack tight"><h3 class="h-section">Prontidão · ${h({ pronta: "Pronta para execução", pendente: "Pendente", bloqueada: "Bloqueada", na: "—" }[rd.state])}</h3>
        <div class="card pad stack tight">${C.READINESS.map(r => `<label class="check"><input type="checkbox" data-ready="${r.id}" ${(job.prontidao || {})[r.id] ? "checked" : ""} ${canEdit ? "" : "disabled"}> ${h(r.label)}${((c.cfg.readinessRequired || {})[job.tipo] || []).includes(r.id) ? ' <span class="tiny muted">(obrigatório)</span>' : ""}</label>`).join("")}</div></section>
      ${job.conclusao ? `<section class="stack tight"><h3 class="h-section">Conclusão</h3><div class="card pad stack tight small">${job.conclusao.notas ? `<div>${h(job.conclusao.notas)}</div>` : ""}${job.conclusao.pendencias ? `<div><b>Pendências:</b> ${h(job.conclusao.pendencias)}</div>` : "<div class='muted'>Sem pendências registradas.</div>"}
        ${(job.conclusao.fotos || []).length ? `<div class="row wrap">${job.conclusao.fotos.map(p => `<a href="${h(p.url)}" target="_blank" rel="noopener"><img src="${h(p.url)}" alt="Foto da conclusão" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"></a>`).join("")}</div>` : ""}
        ${job.conclusao.pendencias && canEdit && !c.jobs.some(m => m.manutencaoDe === job.id) ? `<button class="btn sm" type="button" data-maint="${h(job.id)}">${ic("wrench", 15)}Criar manutenção vinculada</button>` : ""}</div></section>` : ""}
      <section class="stack tight"><h3 class="h-section">Atividade</h3>
        ${acts.length ? `<ol class="timeline">${acts.map(e => `<li><span class="tl-dot">${ic("circle", 8)}</span><div><div class="small">${h(EVENT_LABEL[e.tipo] || e.tipo)}${e.nota ? ` — ${h(e.nota)}` : ""}</div><div class="tiny muted">${h(C.fmtTs(e.at))} · ${e.origem === "campo" ? `check-in de ${h(instName(e.instId))}` : "registrado pelo escritório"}</div></div></li>`).join("")}</ol>` : `<p class="small muted">Nenhuma atividade registrada.</p>`}
      </section></div>`;
    const foot = [];
    if (canEdit) {
      foot.push(`<button class="btn danger-outline" type="button" data-del="${h(job.id)}">${ic("trash-2", 16)}Excluir</button><span class="spacer"></span>`);
      if (job.status === "andamento") foot.push(`<button class="btn" type="button" data-act="pausa" data-id="${h(job.id)}">${ic("pause", 16)}Pausar</button><button class="btn success" type="button" data-act="fim" data-id="${h(job.id)}">${ic("circle-check", 16)}Concluir</button>`);
      else if (job.status === "pausada") foot.push(`<button class="btn accent" type="button" data-act="retomada" data-id="${h(job.id)}">${ic("play", 16)}Retomar</button>`);
      else if (job.status === "agendada" && a.inicio && crewIds.length) foot.push(`<button class="btn accent" type="button" data-act="inicio" data-id="${h(job.id)}">${ic("play", 16)}Iniciar obra</button>`);
      else if (job.status === "concluida") foot.push(`<button class="btn" type="button" data-reopen="${h(job.id)}">${ic("rotate-ccw-clock", 16)}Reabrir</button>`);
      else if (!["cancelada"].includes(job.status)) foot.push(`<button class="btn primary" type="button" data-edit="${h(job.id)}" data-step="2">${ic("sparkles", 16)}Agendar</button>`);
    }
    $(".modal-foot", detailDlg).innerHTML = foot.join("");
    $(".modal-foot", detailDlg).hidden = !foot.length;
  }
  const EVENT_LABEL = { a_caminho: "A caminho da obra", inicio: "Obra iniciada", pausa: "Obra pausada", retomada: "Obra retomada", fim: "Obra concluída", problema: "Problema informado" };
  const origemLabel = o => ({ historico: "histórico real da equipe", perfil: "produtividade do perfil", referencia: "valor de referência — revise", misto: "perfil + referência" }[o] || o);

  /* ---------------- reschedule (shared validator) ---------------- */
  function moveDialog(id, preset) {
    const c = getCtx(), job = c.jobsById[id];
    if (!job) return;
    const a = job.agenda || {};
    const cur = job._members || [];
    const opts = (c.installers || []).filter(i => i.ativo !== false);
    const d = openDialog({
      title: "Remarcar obra", sub: h(job.cliente),
      body: `<div class="stack"><div class="form-grid">
        <div class="field span-3"><label for="mvDate">Início</label><input class="input" type="date" id="mvDate" value="${h((preset && preset.date) || a.inicio || c.today)}"></div>
        <div class="field span-3"><label for="mvHora">Horário</label><input class="input" type="time" id="mvHora" value="${h(a.hora || "08:00")}"></div>
        <div class="field span-6"><label for="mvInst">Instalador</label><select class="select" id="mvInst" ${job.equipeId ? "disabled" : ""}>${job.equipeId ? `<option>${h(crewLabel(job, c))} (equipe — altere no formulário)</option>` : `<option value="">Manter (${h(cur.map(instName).join(", ") || "sem instalador")})</option>${opts.map(i => `<option value="${h(i.id)}" ${preset && preset.inst === i.id ? "selected" : ""}>${h(i.nome)}</option>`).join("")}`}</select></div></div>
        <div id="mvCheck" class="stack tight"></div>
        <div class="field" id="mvWhyWrap" hidden><label for="mvWhy">Justificativa para aceitar o conflito *</label><textarea class="textarea" id="mvWhy"></textarea></div></div>`,
      foot: `<button class="btn" data-x type="button">Cancelar</button><button class="btn primary" type="button" id="mvOk">Salvar nova data</button>`
    });
    const proposal = () => {
      const inst = !job.equipeId && $("#mvInst", d).value;
      const ids = inst ? (cur.length > 1 ? [inst, ...cur.filter(x => x !== inst)].slice(0, cur.length) : [inst]) : cur;
      return { ...job, instaladorIds: job.equipeId ? job.instaladorIds : ids, agenda: { ...a, inicio: $("#mvDate", d).value, hora: $("#mvHora", d).value || "08:00" } };
    };
    const check = () => {
      const p = proposal(), issues = C.validateJob(p, c), al = C.allocate(p, c);
      $("#mvCheck", d).innerHTML = (al.fim ? `<p class="small muted">Término previsto: ${h(C.fmtDate(al.fim))} (${al.blocks.length} dia(s) de trabalho)</p>` : "") + (issues.length ? issues.map(issueHTML).join("") : `<div class="issue tone-success">${ic("circle-check", 16)}<span>Sem conflitos com a agenda atual.</span></div>`);
      $("#mvWhyWrap", d).hidden = !C.hasErrors(issues);
      if (C.hasErrors(issues)) {
        const alt = C.recommend(p, c, 1).candidatos[0];
        if (alt) $("#mvCheck", d).insertAdjacentHTML("beforeend", `<p class="small">Sugestão: <b>${h(alt.nome)}</b> está livre ${alt.data === p.agenda.inicio ? "nesta data" : "a partir de " + h(C.fmtDate(alt.data))} (${alt.score}/100).</p>`);
      }
      return issues;
    };
    ["#mvDate", "#mvHora", "#mvInst"].forEach(s => $(s, d).addEventListener("change", check));
    check();
    $("#mvOk", d).addEventListener("click", async () => {
      const issues = check(), p = proposal();
      if (!C.isDate(p.agenda.inicio)) return toast("Escolha uma data válida.", true);
      const why = $("#mvWhy", d).value.trim();
      if (C.hasErrors(issues) && why.length < 5) { toast("Explique por que o conflito deve ser aceito.", true); $("#mvWhy", d).focus(); return; }
      const patch = { agenda: p.agenda, instaladorIds: p.instaladorIds, hist: [...(job.hist || []), { t: new Date().toISOString(), txt: `Remarcada para ${C.fmtDate(p.agenda.inicio)} ${p.agenda.hora}${p.instaladorIds.join() !== cur.join() ? " · " + p.instaladorIds.map(instName).join(", ") : ""}` }].slice(-40) };
      if (C.hasErrors(issues)) patch.overrides = [...(job.overrides || []), { at: new Date().toISOString(), por: S.uid, motivo: why, conflitos: issues.filter(i => i.severity === "erro").map(i => i.msg) }];
      if (p.status === "rascunho") patch.status = "agendada";
      await guard(() => Store.saveJob(job.id, patch), "Obra remarcada.");
      d.close();
    });
  }

  /* ---------------- shell, routing, roles ---------------- */
  const ROUTES = {
    central: { title: "Central de Obras", icon: "layout-dashboard", group: "Operação" },
    agenda: { title: "Agenda Semanal", icon: "calendar-days", group: "Operação" },
    instaladores: { title: "Instaladores", icon: "hard-hat", group: "Operação" },
    instalacoes: { title: "Instalações", icon: "hammer", group: "Obras" },
    manutencoes: { title: "Manutenções", icon: "wrench", group: "Obras" },
    desempenho: { title: "Desempenho da Equipe", icon: "chart-column", group: "Gestão" },
    ajustes: { title: "Configurações", icon: "settings", group: "Gestão" },
    "minha-agenda": { title: "Minha Agenda", icon: "calendar-check", field: true },
    quadro: { title: "Quadro de Obras", icon: "layout-dashboard", viewer: true },
    "sem-acesso": { title: "Agenda de obras", icon: "info", none: true }
  };
  const App = window.App = {
    C, Store, S, $, $$, h, ic, badge, toast, openDialog, confirmDialog, guard, getCtx, instName, crewLabel, matsLabel, statusBadges, jobCard, dateTile,
    emptyHTML, issueHTML, openJob, moveDialog, jobAction, longDay, shortDay, relDay, initials, origemLabel, EVENT_LABEL,
    views: {}, route: "central", canEdit: false, role: null, ui: {}
  };

  function allowedRoutes() {
    const r = S.role;
    if (r === "admin" || r === "coordenador") return ["central", "agenda", "instaladores", "instalacoes", "manutencoes", "desempenho", "ajustes"];
    if (r === "instalador") return ["minha-agenda"];
    if (r === "visualizador") return ["quadro"];
    return ["sem-acesso"];
  }
  function resolveRoute() {
    let r = location.hash.slice(1);
    if (r === "celular" || r === "pc") { setUi(r === "celular" ? "mobile" : "pc"); r = ""; }
    const allowed = allowedRoutes();
    App.route = allowed.includes(r) ? r : allowed[0];
  }
  /* desktop vs phone, same rule as the Entregas app: device first, then width */
  let uiPref = ""; try { uiPref = localStorage.getItem("mercatto:versao") || ""; } catch (e) { }
  function autoUi() { const ua = navigator.userAgent; return /Android|iPhone|iPod|Mobile|Windows Phone|iPad|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) || innerWidth < 1024 ? "mobile" : "pc"; }
  App.isMobile = () => (uiPref || autoUi()) === "mobile";
  function setUi(v) { uiPref = v; try { if (v) localStorage.setItem("mercatto:versao", v); else localStorage.removeItem("mercatto:versao"); } catch (e) { } applyUi(); }
  App.setUi = setUi; App.uiPref = () => uiPref;
  function applyUi() {
    const m = App.isMobile(), el = document.documentElement;
    el.classList.toggle("ui-mobile", m); el.classList.toggle("ui-pc", !m);
    $("#uiSwitch").innerHTML = m ? ic("monitor", 15) + "Abrir versão para computador" : ic("smartphone", 15) + "Abrir versão para celular";
    if (!m) closeMenu();
  }
  const openMenu = () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); };
  const closeMenu = () => { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); };

  function renderNav() {
    const allowed = allowedRoutes(), c = S.mode === "loading" ? null : getCtx();
    const counts = {};
    if (c && (S.role === "admin" || S.role === "coordenador")) {
      counts.instalacoes = c.jobs.filter(j => j.tipo !== "manutencao" && !["concluida", "cancelada"].includes(j.status)).length;
      counts.manutencoes = c.jobs.filter(j => j.tipo === "manutencao" && !["concluida", "cancelada"].includes(j.status)).length;
    }
    let group = null, html = "";
    for (const r of allowed) {
      const R = ROUTES[r];
      if (R.group && R.group !== group) { group = R.group; html += `<div class="nav-label">${h(group)}</div>`; }
      html += `<a href="#${r}"${App.route === r ? ' aria-current="page"' : ""}>${ic(R.icon, 18)}<span>${h(R.title)}</span>${counts[r] ? `<span class="count">${counts[r]}</span>` : ""}</a>`;
    }
    $("#nav").innerHTML = html;
    const admin = S.role === "admin" || S.role === "coordenador";
    $("#bottomNav").innerHTML = admin ? `
      <a href="#central"${App.route === "central" ? ' aria-current="page"' : ""}>${ic("layout-dashboard", 22)}Central</a>
      <a href="#agenda"${App.route === "agenda" ? ' aria-current="page"' : ""}>${ic("calendar-days", 22)}Agenda</a>
      ${App.canEdit ? `<button type="button" data-new aria-label="Nova obra"><span class="fab">${ic("plus", 22)}</span></button>` : ""}
      <a href="#instaladores"${App.route === "instaladores" ? ' aria-current="page"' : ""}>${ic("hard-hat", 22)}Equipe</a>
      <button type="button" data-menu>${ic("ellipsis", 22)}Mais</button>` : "";
    $("#bottomNav").hidden = !admin;
    $("#btnNewTop").hidden = !(admin && App.canEdit);
    $("#btnBell").parentElement.hidden = !admin;
    // sync indicator
    const sy = $("#syncState"), d = Store.describeMode(S.mode);
    let cls = "", txt;
    if (S.mode === "local") { cls = "local"; txt = "Só neste navegador"; }
    else if (!S.online) { cls = "bad"; txt = S.pending ? `Sem conexão · ${S.pending} alteração(ões) não sincronizada(s)` : "Sem conexão"; }
    else if (S.pending) { cls = "warn"; txt = `Salvando ${S.pending} alteração(ões)…`; }
    else if (S.lastError) { cls = "bad"; txt = "Falha ao salvar — tente de novo"; }
    else txt = S.mode === "db" ? "Sincronizado com a equipe" : "Conectando…";
    sy.className = "sync " + cls; sy.innerHTML = `<span class="dot"></span><span>${h(txt)}</span>`; sy.title = d.label;
    if (S.me && S.me.name) { $("#meName").textContent = S.me.name; $("#meAvatar").textContent = initials(S.me.name); }
    $("#meRole").textContent = S.role ? (C.ROLES[S.role] || { label: "Sem acesso" }).label : "Carregando…";
  }

  let lastRoute = null;
  function render(force) {
    App.role = S.role;
    App.canEdit = (S.role === "admin" || S.role === "coordenador") && S.canWrite;
    document.body.classList.toggle("ro", !App.canEdit);
    resolveRoute();
    renderNav();
    const R = ROUTES[App.route];
    $("#tbTitle").textContent = R.title;
    $("#tbSub").textContent = longDay(C.today());
    const el = $("#content");
    const ready = S.mode === "local" || (S.mode === "db" && S.role && (S.role === "instalador" || S.role === "visualizador" || S.role === "sem_acesso" || (S.loaded.obras && S.loaded.instaladores && S.loaded.equipes && S.loaded.cfg)));
    if (!ready) { el.innerHTML = `<div class="stack loose"><div class="stats">${'<div class="skeleton" style="height:64px"></div>'.repeat(8)}</div><div class="skeleton" style="height:280px"></div></div>`; return; }
    const view = App.views[App.route === "sem-acesso" ? "semAcesso" : App.route.replace(/-([a-z])/g, (m, x) => x.toUpperCase())];
    const routeChanged = lastRoute !== App.route;
    lastRoute = App.route;
    if (view) view(el, { routeChanged: routeChanged || force });
    if (detailDlg) renderDetail();
    renderBell();
    if (S.mode === "db" && (S.role === "admin" || S.role === "coordenador") && !getCtx().virtual) scheduleProjections();
  }
  App.render = render;

  /* ---------------- alerts bell ---------------- */
  function renderBell() {
    if (!(S.role === "admin" || S.role === "coordenador")) return;
    const c = getCtx();
    const list = activeAlerts(c);
    const high = list.filter(a => a.severity === "alta").length;
    $("#bellDot").hidden = !list.length; $("#bellDot").textContent = list.length;
    const pop = $("#bellPop");
    if (!pop.hidden) $("#bellList").innerHTML = list.length ? list.slice(0, 30).map(alertRow).join("") : emptyHTML("circle-check", "Nenhum alerta em aberto");
    $("#btnBell").setAttribute("aria-label", `Alertas: ${list.length} em aberto, ${high} prioritários`);
  }
  function activeAlerts(c) { const dis = (S.alertState && S.alertState.dispensados) || {}; return C.buildAlerts(c, { problemas: problemEvents(c) }).filter(a => !dis[a.key]); }
  function problemEvents(c) {
    return (c.events || []).filter(e => e.tipo === "problema" && !(c.jobsById[e.jobId] && (c.jobsById[e.jobId].atividade || []).some(x => x.id === e.id && x.resolvido))).map(e => ({ id: e.id, jobId: e.jobId, nota: e.nota, cliente: (c.jobsById[e.jobId] || {}).cliente || "Obra" }));
  }
  const SEVTONE = { alta: "danger", media: "warning", baixa: "neutral" };
  function alertRow(a) {
    return `<div class="rowitem" style="cursor:default"><span class="ic si-${SEVTONE[a.severity]}">${ic(a.severity === "alta" ? "triangle-alert" : "info", 16)}</span>
      <span class="grow stack" style="gap:1px"><span class="small strong">${h(a.tipo)}</span><span class="tiny muted">${h(a.msg)}</span></span>
      <span class="row" style="gap:4px">${alertActionBtn(a)}${App.canEdit ? `<button class="btn ghost icon sm" type="button" data-dismiss="${h(a.key)}" title="Dispensar" aria-label="Dispensar alerta">${ic("x", 14)}</button>` : ""}</span></div>`;
  }
  function alertActionBtn(a) {
    const c = getCtx(), job = a.jobId && c.jobsById[a.jobId];
    if (a.acao === "whatsapp_confirmar" && job && job.fone) return `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="${h(C.waLink(job.fone, C.waTemplates(job, c).cliente[0].text))}">Confirmar</a>`;
    if (a.acao === "atribuir" && job) return `<button class="btn sm" type="button" data-edit="${h(job.id)}" data-step="2">Atribuir</button>`;
    if (a.acao === "reagendar" && job) return `<button class="btn sm" type="button" data-move="${h(job.id)}">Remarcar</button>`;
    if (a.acao === "criar_manutencao" && job) return `<button class="btn sm" type="button" data-maint="${h(job.id)}">Criar</button>`;
    if (a.acao === "realocar" && a.instId) return `<a class="btn sm" href="#agenda" data-agenda-inst="${h(a.instId)}">Agenda</a>`;
    if (job) return `<button class="btn sm" type="button" data-open="${h(job.id)}">Resolver</button>`;
    return "";
  }
  App.activeAlerts = activeAlerts; App.alertRow = alertRow;
  async function dismiss(key) {
    const st = { dispensados: { ...((S.alertState && S.alertState.dispensados) || {}), [key]: { at: new Date().toISOString(), por: S.uid || null } } };
    // keep the map small: drop dismissals older than 60 days
    const cutoff = new Date(Date.now() - 60 * 864e5).toISOString();
    for (const [k, v] of Object.entries(st.dispensados)) if (v.at < cutoff) delete st.dispensados[k];
    await guard(() => Store.setAlertState(st), "Dispensado.");
  }

  /* ---------------- projections for installers and viewers ---------------- */
  let projTimer = 0;
  function scheduleProjections() { clearTimeout(projTimer); projTimer = setTimeout(publishProjections, 2000); }
  async function publishProjections() {
    if (S.mode !== "db" || !(S.role === "admin" || S.role === "coordenador")) return;
    const c = getCtx();
    if (c.virtual) return;
    for (const p of S.acessos.pessoas || []) {
      try {
        if (p.papel === "instalador" && p.instaladorId) await Store.writeProjection(p.id, installerProjection(p, c));
        else if (p.papel === "visualizador") await Store.writeProjection(p.id, viewerProjection(c));
      } catch (e) { /* surfaced by the sync indicator */ }
    }
  }
  function slimJob(j, c, full) {
    const al = C.allocate(j, c);
    const o = { id: j.id, cliente: j.cliente, tipo: j.tipo, status: j.status, prio: j.prio || "", itens: j.itens || [], servico: j.servico || "", agenda: { inicio: (j.agenda || {}).inicio || "", hora: (j.agenda || {}).hora || "" }, fimPrevisto: al.fim, dias: al.blocks.map(b => ({ d: b.date, s: C.fromMin(b.start), e: C.fromMin(b.end) })), bairro: (j.endereco || {}).bairro || "", equipe: crewLabel(j, c) };
    if (full) Object.assign(o, { fone: j.fone || "", endereco: j.endereco || {}, obs: j.obs || "", prontidao: C.readiness(j, c).missing, real: j.real || {} });
    return o;
  }
  function installerProjection(p, c) {
    const since = C.addDays(c.today, -14);
    const mine = c.jobs.filter(j => (j._members || []).includes(p.instaladorId) && j.status !== "rascunho" && j.status !== "cancelada" && (j.status !== "concluida" || (j.real && j.real.fim && C.tsParts(j.real.fim).date >= since)));
    const inst = c.installersById[p.instaladorId] || {};
    return { papel: "instalador", instaladorId: p.instaladorId, nome: inst.nome || "", cidade: c.cfg.city, obras: mine.map(j => slimJob(j, c, true)), atualizado: new Date().toISOString().slice(0, 16) };
  }
  function viewerProjection(c) {
    const since = C.addDays(c.today, -30);
    const jobs = c.jobs.filter(j => j.status !== "rascunho" && (j.status !== "concluida" || (j.real && j.real.fim && C.tsParts(j.real.fim).date >= since))).slice(0, 400);
    return { papel: "visualizador", instaladores: (c.installers || []).filter(i => i.ativo !== false).map(i => ({ id: i.id, nome: i.nome, status: C.installerStatus(i, c, c.events).label })), obras: jobs.map(j => slimJob(j, c, false)), atualizado: new Date().toISOString().slice(0, 16) };
  }

  /* ---------------- global events ---------------- */
  document.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest("a[target=_blank]")) return;
    const pop = t.closest("[data-wamenu]");
    if (pop) { const p = pop.parentElement.querySelector("[data-wapop]"); p.hidden = !p.hidden; return; }
    if (!t.closest("#bellPop") && !t.closest("#btnBell")) $("#bellPop").hidden = true;
    if (t.closest("#btnBell")) { $("#bellPop").hidden = !$("#bellPop").hidden; renderBell(); return; }
    if (t.closest("[data-menu]") || t.closest("#btnMenu")) { openMenu(); return; }
    if (t.closest("#scrim") || t.closest("#nav a")) closeMenu();
    if (t.closest("#uiSwitch")) { setUi(App.isMobile() ? "pc" : "mobile"); render(true); return; }
    const b = (sel) => t.closest(sel);
    let x;
    if (b("[data-new]")) { if (!getCtx().virtual) App.openForm(null, App.ui.newPreset ? App.ui.newPreset() : null); else toast("Atualize os dados (em Configurações) antes de criar obras.", true); return; }
    if ((x = b("[data-edit]"))) { if (detailDlg && x.closest("dialog") === detailDlg) detailDlg.close(); App.openForm(x.dataset.edit, null, Number(x.dataset.step || 0)); return; }
    if ((x = b("[data-move]"))) { moveDialog(x.dataset.move); return; }
    if ((x = b("[data-act]"))) { jobAction(x.dataset.id, x.dataset.act); return; }
    if ((x = b("[data-del]"))) {
      const job = getCtx().jobsById[x.dataset.del];
      if (job && await confirmDialog(`Excluir a obra de ${job.cliente}? Isso não pode ser desfeito.`, "Excluir obra", true)) { await guard(() => Store.deleteJob(job.id), "Obra excluída."); if (detailDlg) detailDlg.close(); }
      return;
    }
    if ((x = b("[data-reopen]"))) { const job = getCtx().jobsById[x.dataset.reopen]; await guard(() => Store.saveJob(job.id, { status: "andamento", real: { ...(job.real || {}), fim: null } }), "Obra reaberta."); return; }
    if ((x = b("[data-maint]"))) { const job = getCtx().jobsById[x.dataset.maint]; if (detailDlg) detailDlg.close(); App.openForm(null, { tipo: "manutencao", manutencaoDe: job.id, cliente: job.cliente, fone: job.fone, endereco: job.endereco, itens: (job.itens || []).map(i => ({ ...i, qtd: null })), servico: "Retorno: " + ((job.conclusao || {}).pendencias || ""), instaladorIds: job._members || [], retrabalho: true }); return; }
    if ((x = b("[data-dismiss]"))) { dismiss(x.dataset.dismiss); return; }
    if ((x = b("[data-open]"))) { openJob(x.dataset.open); return; }
  });
  document.addEventListener("change", async e => {
    const r = e.target.closest("[data-ready]");
    if (r && detailId) {
      const job = getCtx().jobsById[detailId];
      await guard(() => Store.saveJob(job.id, { prontidao: { ...(job.prontidao || {}), [r.dataset.ready]: r.checked } }));
    }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("#bellPop").hidden = true; });
  window.addEventListener("hashchange", () => { closeMenu(); render(true); window.scrollTo(0, 0); });
  window.addEventListener("resize", () => { if (!uiPref) { const was = document.documentElement.classList.contains("ui-mobile"); if (was !== App.isMobile()) { applyUi(); render(true); } } });

  App.boot = async function () {
    applyUi();
    let v = 0;
    Store.subscribe(() => { S._v = ++v; ctx = null; render(); });
    render();
    await Store.connect();
    render(true);
    setInterval(() => { ctx = null; render(); }, 5 * 60 * 1000);
  };
})();
