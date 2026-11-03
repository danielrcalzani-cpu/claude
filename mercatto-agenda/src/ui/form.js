/* Job creation / edit wizard: Cliente → Serviço → Agenda → Prontidão → Confirmação. */
(function () {
  "use strict";
  const A = window.App, C = A.C, Store = A.Store, { $, $$, h, ic, badge } = A;
  const STEPS = ["Cliente", "Serviço", "Agenda", "Prontidão", "Confirmação"];
  const SERVICOS = ["Retirar e recolocar peças para acesso a encanamento", "Retirar e recolocar peças para acesso à parte elétrica", "Troca de peça danificada", "Ajuste de acabamento ou rodapé", "Reparo por infiltração", "Revisão geral"];

  let W = null, step = 0, dlg = null, original = null, recState = null;

  function blank(preset) {
    const c = A.getCtx();
    return {
      tipo: "instalacao", status: "agendada", prio: "", cliente: "", fone: "",
      endereco: { completo: "", bairro: "", ref: "", lat: null, lng: null },
      itens: [{ mat: "", label: "", qtd: null, unidade: "m²" }], complexidade: "normal", servico: "", obs: "",
      equipeNecessaria: 1, instaladorIds: [], equipeId: null,
      agenda: { inicio: "", hora: "08:00", horas: null, horasManual: false },
      prontidao: {}, atividade: [], hist: [], ...(preset || {}),
      ...(preset && preset.endereco ? { endereco: { completo: "", bairro: "", ref: "", lat: null, lng: null, ...preset.endereco } } : {}),
      ...(preset && preset.agenda ? { agenda: { inicio: "", hora: "08:00", horas: null, horasManual: false, ...preset.agenda } } : {})
    };
  }

  A.openForm = function (id, preset, startStep) {
    const c = A.getCtx();
    if (!A.canEdit) return;
    original = id ? c.jobsById[id] : null;
    W = original ? JSON.parse(JSON.stringify(original)) : blank(preset);
    delete W._members;
    if (!W.itens || !W.itens.length) W.itens = [{ mat: "", qtd: null, unidade: "m²" }];
    W.agenda = { hora: "08:00", ...(W.agenda || {}) };
    W.endereco = { completo: "", bairro: "", ref: "", ...(W.endereco || {}) };
    step = startStep || 0; recState = null;
    dlg = A.openDialog({
      title: original ? (W.tipo === "manutencao" ? "Editar manutenção" : "Editar obra") : (W.tipo === "manutencao" ? "Nova manutenção" : "Nova obra"),
      sub: "Só o nome do cliente é obrigatório. O resto pode ser completado depois — salve como rascunho a qualquer momento.",
      wide: true, body: "", foot: "", onClose: () => { dlg = null; }
    });
    renderAll();
  };

  function renderAll() {
    if (!dlg) return;
    $(".modal-body", dlg).innerHTML = `<div class="stack loose"><nav class="steps" aria-label="Etapas">${STEPS.map((s, i) => `<button type="button" data-step-go="${i}" ${i === step ? 'aria-current="step"' : ""} class="${i < step ? "done" : ""}"><span class="n">${i < step ? "✓" : i + 1}</span><span class="t">${s}</span></button>`).join("")}</nav><div id="wzBody"></div><div id="wzCheck" class="stack tight"></div></div>`;
    $("#wzBody", dlg).innerHTML = [stepCliente, stepServico, stepAgenda, stepProntidao, stepConfirmar][step]();
    $(".modal-foot", dlg).innerHTML = `
      ${step > 0 ? `<button class="btn" type="button" data-prev>${ic("chevron-left", 16)}Voltar</button>` : `<button class="btn" type="button" data-x>Cancelar</button>`}
      <span class="spacer"></span>
      <button class="btn" type="button" data-save="draft">Salvar rascunho</button>
      ${step < STEPS.length - 1 ? `<button class="btn primary" type="button" data-next>Continuar${ic("chevron-right", 16)}</button>` : `<button class="btn primary" type="button" data-save="confirm">${ic("check", 16)}${original && original.status !== "rascunho" ? "Salvar alterações" : "Confirmar obra"}</button>`}`;
    bind();
    if (step === 2 || step === 4) renderCheck();
    else $("#wzCheck", dlg).innerHTML = "";
    const first = $("#wzBody input, #wzBody select", dlg);
    if (first && !A.isMobile() && step === 0) first.focus();
  }

  /* ---------- step 1: customer ---------- */
  function stepCliente() {
    const e = W.endereco;
    return `<div class="form-grid">
      <div class="field span-6"><label for="fCli">Nome do cliente *</label><input class="input" id="fCli" data-k="cliente" value="${h(W.cliente)}" autocomplete="off"><span class="error" id="errCli" hidden></span></div>
      <div class="field span-3"><label for="fFone">WhatsApp</label><input class="input" id="fFone" data-k="fone" type="tel" inputmode="tel" placeholder="(92) 99123-4567" value="${h(W.fone)}"></div>
      <div class="field span-3"><label for="fBairro">Bairro</label><input class="input" id="fBairro" data-k="endereco.bairro" list="dlBairros" value="${h(e.bairro)}" placeholder="Ex.: Adrianópolis"><datalist id="dlBairros">${[...new Set(A.getCtx().jobs.map(j => (j.endereco || {}).bairro).filter(Boolean))].sort().map(b => `<option value="${h(b)}">`).join("")}</datalist></div>
      <div class="field span-6"><label for="fEnd">Endereço completo</label><input class="input" id="fEnd" data-k="endereco.completo" value="${h(e.completo)}" placeholder="Rua, número, condomínio, apartamento"></div>
      <div class="field span-3"><label for="fRef">Ponto de referência</label><input class="input" id="fRef" data-k="endereco.ref" value="${h(e.ref)}"></div>
      <div class="field span-3"><label for="fCoord">Coordenadas do local</label><input class="input" id="fCoord" placeholder="Cole o link do Google Maps ou -3.10, -60.02" value="${C.hasCoords(e) ? `${e.lat}, ${e.lng}` : ""}"><span class="hint" id="coordHint">${C.hasCoords(e) ? "Localização definida." : "Opcional. Melhora as sugestões por proximidade."}</span></div>
    </div>`;
  }
  /* ---------- step 2: service ---------- */
  function stepServico() {
    return `<div class="stack">
      <div class="field"><span class="label">Tipo</span><div class="chip-row" role="group" aria-label="Tipo">
        <button type="button" class="chip" data-set="tipo" data-v="instalacao" aria-pressed="${W.tipo === "instalacao"}">${ic("hammer", 15)}Instalação</button>
        <button type="button" class="chip" data-set="tipo" data-v="manutencao" aria-pressed="${W.tipo === "manutencao"}">${ic("wrench", 15)}Manutenção</button></div></div>
      ${W.tipo === "manutencao" ? `<div class="field"><label for="fServ">O que precisa ser feito</label><input class="input" id="fServ" data-k="servico" list="dlServ" value="${h(W.servico)}"><datalist id="dlServ">${SERVICOS.map(s => `<option value="${h(s)}">`).join("")}</datalist>
        <label class="check"><input type="checkbox" data-kb="retrabalho" ${W.retrabalho ? "checked" : ""}> Retrabalho de uma obra da Mercatto (conta no desempenho)</label></div>` : ""}
      <div class="stack tight"><span class="label">Materiais e quantidades</span>
        ${W.itens.map((it, i) => `<div class="row wrap" data-item="${i}" style="gap:8px">
          <select class="select" data-it="mat" aria-label="Material" style="flex:2 1 220px;width:auto"><option value="">Escolha o material…</option>${C.MATERIALS.map(m => `<option value="${m.id}" ${it.mat === m.id ? "selected" : ""}>${h(m.label)}</option>`).join("")}</select>
          <input class="input" data-it="qtd" type="number" min="0" step="0.1" inputmode="decimal" aria-label="Quantidade" placeholder="Quantidade" value="${it.qtd != null ? h(it.qtd) : ""}" style="flex:1 1 110px;width:auto">
          <select class="select" data-it="unidade" aria-label="Unidade" style="flex:0 1 100px;width:auto">${C.UNITS.map(u => `<option ${it.unidade === u ? "selected" : ""}>${u}</option>`).join("")}</select>
          ${it.mat === "outro" ? `<input class="input" data-it="label" placeholder="Descreva o material" value="${h(it.label || "")}" style="flex:2 1 200px;width:auto">` : ""}
          ${W.itens.length > 1 ? `<button class="btn ghost icon sm" type="button" data-rm-item="${i}" aria-label="Remover material">${ic("x", 15)}</button>` : ""}
          ${it.unidadeInferida ? `<span class="tiny" style="color:var(--warning-text)">Unidade deduzida da agenda antiga — confirme.</span>` : ""}
        </div>`).join("")}
        ${W.materialOriginal ? `<span class="hint tiny muted">Na agenda antiga estava: “${h(W.materialOriginal)}${W.qtdOriginal ? " — " + h(W.qtdOriginal) : ""}”.</span>` : ""}
        <div><button class="btn sm" type="button" data-add-item>${ic("plus", 15)}Adicionar material</button></div></div>
      <div class="form-grid">
        <div class="field span-3"><span class="label">Complexidade</span><div class="segmented" role="group" aria-label="Complexidade">${Object.entries(C.COMPLEXITY).map(([k, v]) => `<button type="button" data-set="complexidade" data-v="${k}" aria-pressed="${W.complexidade === k}">${h(v.label)}</button>`).join("")}</div></div>
        <div class="field span-3"><label for="fEq">Instaladores necessários</label><input class="input" id="fEq" type="number" min="1" max="6" data-k="equipeNecessaria" data-num value="${h(W.equipeNecessaria || 1)}"></div>
        <div class="field span-6"><span class="label">Urgência</span><div class="chip-row">${Object.entries(C.PRIORITY).map(([k, v]) => `<button type="button" class="chip" data-set="prio" data-v="${k}" data-toggle aria-pressed="${W.prio === k}">${h(v.label)}</button>`).join("")}</div></div>
        <div class="field span-6"><label for="fObs">Instruções para a equipe</label><textarea class="textarea" id="fObs" data-k="obs" placeholder="Medidas, acesso, cuidados, pendências…">${h(W.obs)}</textarea></div>
      </div></div>`;
  }
  /* ---------- step 3: scheduling ---------- */
  function stepAgenda() {
    const c = A.getCtx(), a = W.agenda, est = C.estimateDuration(W, c);
    const teams = c.teams || [];
    const actives = (c.installers || []).filter(i => i.ativo !== false);
    return `<div class="stack">
      <div class="card pad stack tight">
        <div class="row between wrap"><span class="h-section">Duração estimada</span>${est.horas ? badge(est.origem === "referencia" ? "warning" : "success", A.origemLabel(est.origem)) : ""}</div>
        ${est.horas ? `<div><b style="font-size:20px">${C.fmtNum(est.horas)} h</b> <span class="muted">≈ ${C.fmtNum(est.dias)} dia(s) de trabalho</span></div><div class="tiny muted">${h(est.detalhe)}</div>` : `<div class="small" style="color:var(--warning-text)">${h(est.motivo)}</div>`}
        <label class="check"><input type="checkbox" id="fManual" ${a.horasManual ? "checked" : ""}> Definir a duração manualmente</label>
        <div class="row" id="manualWrap" ${a.horasManual ? "" : "hidden"}><input class="input" type="number" min="0.5" step="0.5" id="fHoras" value="${h(a.horasManual ? a.horas : est.horas || "")}" style="max-width:140px"><span class="small muted">horas de trabalho da equipe</span></div>
      </div>
      <div class="form-grid">
        <div class="field span-2"><label for="fIni">Início desejado</label><input class="input" type="date" id="fIni" data-k="agenda.inicio" value="${h(a.inicio)}"><span class="hint">Deixe em branco para receber a primeira data livre.</span></div>
        <div class="field span-2"><label for="fHora">Horário de chegada</label><input class="input" type="time" id="fHora" data-k="agenda.hora" value="${h(a.hora || "08:00")}"></div>
        <div class="field span-2"><span class="label">Situação</span><div class="segmented" role="group" aria-label="Situação">
          <button type="button" data-set="status" data-v="aguardando" aria-pressed="${W.status === "aguardando"}">Aguarda cliente</button>
          <button type="button" data-set="status" data-v="agendada" aria-pressed="${W.status === "agendada" || W.status === "rascunho"}">Confirmada</button></div></div>
      </div>
      <div class="card"><div class="card-head"><span class="h-section">${ic("sparkles", 16)} Sugerir melhor instalador</span><button class="btn accent sm" type="button" data-recommend>${recState ? "Recalcular" : "Calcular sugestões"}</button></div>
        <div class="card-body stack" id="recBox">${recState ? recHTML() : `<p class="small muted">Analisa especialidade no material, disponibilidade no período inteiro, proximidade (quando há localização), produtividade e histórico. Instaladores sem o material ou sem vaga são descartados antes da pontuação.</p>`}</div></div>
      <div class="stack tight"><span class="label">Atribuição manual</span>
        <div class="segmented" role="group" aria-label="Tipo de atribuição"><button type="button" data-assign-mode="ind" aria-pressed="${!W.equipeId}">Instaladores</button><button type="button" data-assign-mode="team" aria-pressed="${!!W.equipeId}">Equipe</button></div>
        ${W.equipeId || W._teamMode ? `<select class="select" id="fTeam"><option value="">Escolha a equipe…</option>${teams.map(t => `<option value="${h(t.id)}" ${W.equipeId === t.id ? "selected" : ""}>${h(t.nome)} (${t.membros.length})</option>`).join("")}</select>`
        : `<div class="chip-row">${actives.map(i => { const st = C.installerStatus(i, c, c.events); return `<button type="button" class="chip" data-inst="${h(i.id)}" aria-pressed="${(W.instaladorIds || []).includes(i.id)}">${h(i.nome)} <span class="n">${h(st.label)}</span></button>`; }).join("") || `<span class="small muted">Cadastre instaladores em “Instaladores”.</span>`}</div>`}
      </div></div>`;
  }
  function recHTML() {
    const r = recState;
    if (!r) return "";
    const c = A.getCtx();
    const sel = id => (W.equipeId ? W.equipeId === id : (W.instaladorIds || []).join() === id);
    let out = r.candidatos.length ? r.candidatos.map((x, i) => `<div class="cand ${sel(x.kind === "equipe" ? x.id : x.members.join()) ? "sel" : ""}">
      <div class="score">${x.score}<small>/100</small></div>
      <div class="stack tight"><div class="row wrap"><b>${i === 0 ? "Recomendado: " : ""}${h(x.nome)}</b>${x.kind === "equipe" ? badge("accent", "Equipe") : ""}${badge(x.confianca === "alta" ? "success" : x.confianca === "média" ? "info" : "warning", "Confiança " + x.confianca)}</div>
        <div class="tiny muted">${x.data ? `Disponível ${h(A.relDay(x.data, c.today).toLowerCase())} (${C.fmtDate(x.data)})` : ""}${x.estimativa && x.estimativa.horas ? ` · ${C.fmtNum(x.estimativa.horas)} h estimadas` : ""}${x.km != null ? ` · ${C.fmtNum(x.km)} km em linha reta` : ""}</div>
        <ul class="reasons">${x.reasons.map(t => `<li>${h(t)}</li>`).join("")}</ul>
        ${x.fatoresAusentes.length ? `<div class="tiny faint">Sem dados de ${x.fatoresAusentes.map(f => ({ proximity: "localização", productivity: "produtividade", history: "histórico" }[f])).join(", ")} — peso redistribuído.</div>` : ""}</div>
      <div class="cand-act"><button class="btn ${i === 0 ? "primary" : ""} sm" type="button" data-pick="${i}">Escolher</button></div></div>`).join("")
      : `<div class="issue tone-warning">${ic("triangle-alert", 16)}<span>Nenhum instalador cumpre todos os requisitos${W.agenda.inicio ? " nesta data" : ""}. Veja os motivos abaixo, tente outra data ou atribua manualmente.</span></div>`;
    if (r.rejeitados.length) out += `<details><summary class="small muted" style="cursor:pointer">Descartados (${r.rejeitados.length})</summary><div class="stack tight" style="margin-top:8px">${r.rejeitados.map(x => `<div class="small"><b>${h(x.nome)}</b>: ${h(x.motivos.join("; "))}${x.proximaData ? ` — livre a partir de ${C.fmtDate(x.proximaData)}` : ""}</div>`).join("")}</div></details>`;
    out += `<p class="tiny faint">Pesos: especialidade ${r.pesos.expertise}%, disponibilidade ${r.pesos.availability}%, proximidade ${r.pesos.proximity}%, produtividade ${r.pesos.productivity}%, histórico ${r.pesos.history}%. Distâncias só aparecem quando as duas obras têm localização definida e são em linha reta, não tempo de trajeto.</p>`;
    return out;
  }
  /* ---------- step 4: readiness ---------- */
  function stepProntidao() {
    const c = A.getCtx(), req = (c.cfg.readinessRequired || {})[W.tipo] || [];
    const rd = C.readiness(W, c);
    return `<div class="stack"><p class="small muted">Itens obrigatórios para “${W.tipo === "manutencao" ? "manutenção" : "instalação"}” são definidos em Configurações. A obra pode ficar agendada de forma provisória enquanto algo estiver pendente.</p>
      <div class="card pad stack tight">${C.READINESS.map(r => `<label class="check"><input type="checkbox" data-ready-w="${r.id}" ${W.prontidao[r.id] ? "checked" : ""}> ${h(r.label)} ${req.includes(r.id) ? '<span class="tiny muted">(obrigatório)</span>' : ""}</label>`).join("")}</div>
      <div id="rdState">${readyBadge(rd)}</div></div>`;
  }
  const readyBadge = rd => badge({ pronta: "success", pendente: "warning", bloqueada: "danger", na: "neutral" }[rd.state], { pronta: "Pronta para execução", pendente: "Pendente: " + rd.missing.join(", "), bloqueada: "Bloqueada: " + rd.missing.join(", "), na: "—" }[rd.state]);
  /* ---------- step 5: confirmation ---------- */
  function stepConfirmar() {
    const c = A.getCtx(), al = C.allocate(W, c), a = W.agenda;
    const crew = C.jobMembers(W, c.teams).map(A.instName).join(", ");
    const row = (k, v) => `<tr><td class="muted" style="width:38%">${h(k)}</td><td>${v}</td></tr>`;
    return `<div class="stack"><div class="card table-wrap"><table class="table"><tbody>
      ${row("Cliente", h(W.cliente || "—") + (W.fone ? ` · ${h(W.fone)}` : ""))}
      ${row("Endereço", h([W.endereco.completo, W.endereco.bairro].filter(Boolean).join(" — ") || "Não informado"))}
      ${row("Serviço", `${W.tipo === "manutencao" ? "Manutenção" : "Instalação"}${W.servico ? " · " + h(W.servico) : ""}`)}
      ${row("Materiais", h(A.matsLabel(W) || "Não informado"))}
      ${row("Início", a.inicio ? h(A.longDay(a.inicio)) + (a.hora ? ", " + h(a.hora) : "") : "Sem data (fica em “Para marcar data”)")}
      ${row("Término previsto", al.fim ? `${h(C.fmtDate(al.fim))} · ${al.blocks.length} dia(s), ${C.fmtNum(al.horas)} h` : "—")}
      ${row("Instaladores", h(crew || "Nenhum"))}
      ${row("Situação", h((C.STATUS[W.status] || C.STATUS.agendada).label))}
      ${row("Prontidão", readyBadge(C.readiness(W, c)))}</tbody></table></div>
      <div class="field" id="whyWrap" hidden><label for="fWhy">Justificativa para confirmar com conflito *</label><textarea class="textarea" id="fWhy" placeholder="Ex.: cliente pediu esta data; a equipe vai estender o expediente"></textarea></div></div>`;
  }

  /* ---------- live validation ---------- */
  function renderCheck() {
    const box = dlg && $("#wzCheck", dlg);
    if (!box) return;
    const c = A.getCtx();
    const probe = { ...W, id: original ? original.id : "__novo__", status: W.status === "rascunho" ? "agendada" : W.status };
    const issues = C.validateJob(probe, c);
    const al = C.allocate(probe, c);
    box.innerHTML = `<span class="label">Validação da agenda</span>` + (al.fim ? `<p class="small muted">Ocupa ${al.blocks.map(b => `${A.shortDay(b.date)} ${C.fromMin(b.start)}–${C.fromMin(b.end)}`).join(" · ")}</p>` : "") +
      (issues.length ? issues.map(A.issueHTML).join("") : `<div class="issue tone-success">${ic("circle-check", 16)}<span>${al.blocks.length ? "Sem conflitos de agenda." : "Sem data ou duração: nada reservado ainda."}</span></div>`);
    const ww = $("#whyWrap", dlg);
    if (ww) ww.hidden = !C.hasErrors(issues);
    return issues;
  }

  /* ---------- binding ---------- */
  function setPath(obj, path, val) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = val; }
  function bind() {
    $$("[data-k]", dlg).forEach(el => el.addEventListener("input", () => { setPath(W, el.dataset.k, el.dataset.num !== undefined ? Math.max(1, Number(el.value) || 1) : el.value); if (step === 2) { recState = null; const rb = $("#recBox", dlg); if (rb) rb.innerHTML = `<p class="small muted">Dados alterados — clique em “Recalcular”.</p>`; renderCheck(); } }));
    $$("[data-kb]", dlg).forEach(el => el.addEventListener("change", () => { W[el.dataset.kb] = el.checked; }));
    const coord = $("#fCoord", dlg);
    if (coord) coord.addEventListener("change", () => {
      const p = C.parseCoords(coord.value), hint = $("#coordHint", dlg);
      if (!coord.value.trim()) { W.endereco.lat = null; W.endereco.lng = null; hint.textContent = "Opcional."; return; }
      if (!p) { hint.textContent = "Não reconheci coordenadas. Cole o link do Google Maps do local (com @lat,lng) ou “-3.10, -60.02”."; hint.style.color = "var(--danger-text)"; return; }
      W.endereco.lat = p.lat; W.endereco.lng = p.lng; W.endereco.coordFonte = "manual";
      hint.style.color = ""; hint.textContent = p.dentroDeManaus ? "Localização definida." : "Localização definida — parece estar fora de Manaus, confira.";
    });
    $$("[data-it]", dlg).forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      const i = Number(el.closest("[data-item]").dataset.item), k = el.dataset.it, it = W.itens[i];
      if (k === "qtd") it.qtd = el.value === "" ? null : Number(el.value);
      else it[k] = el.value;
      if (k === "mat") { it.label = it.mat && it.mat !== "outro" ? C.MAT[it.mat].label : ""; it.unidade = it.mat ? C.MAT[it.mat].unit : it.unidade; it.unidadeInferida = false; renderAll(); }
      if (k === "unidade") it.unidadeInferida = false;
    }));
    const man = $("#fManual", dlg);
    if (man) {
      man.addEventListener("change", () => { W.agenda.horasManual = man.checked; $("#manualWrap", dlg).hidden = !man.checked; if (!man.checked) W.agenda.horas = null; else W.agenda.horas = Number($("#fHoras", dlg).value) || null; recState = null; renderCheck(); });
      $("#fHoras", dlg).addEventListener("input", e => { W.agenda.horas = Number(e.target.value) || null; renderCheck(); });
    }
    const team = $("#fTeam", dlg);
    if (team) team.addEventListener("change", () => { W.equipeId = team.value || null; W.instaladorIds = []; renderCheck(); });
    $$("[data-ready-w]", dlg).forEach(el => el.addEventListener("change", () => { W.prontidao[el.dataset.readyW] = el.checked; $("#rdState", dlg).innerHTML = readyBadge(C.readiness(W, A.getCtx())); }));
  }

  function validateStep(target) {
    if (step === 0 && target > 0 && !W.cliente.trim()) { const e = $("#errCli", dlg); e.hidden = false; e.textContent = "Informe o nome do cliente."; $("#fCli", dlg).setAttribute("aria-invalid", "true"); $("#fCli", dlg).focus(); return false; }
    return true;
  }

  document.addEventListener("click", async e => {
    if (!dlg || !dlg.contains(e.target)) return;
    const t = e.target;
    let x;
    if ((x = t.closest("[data-step-go]"))) { const n = Number(x.dataset.stepGo); if (n <= step || validateStep(n)) { step = n; renderAll(); } return; }
    if (t.closest("[data-next]")) { if (validateStep(step + 1)) { step++; renderAll(); } return; }
    if (t.closest("[data-prev]")) { step--; renderAll(); return; }
    if ((x = t.closest("[data-set]"))) { const k = x.dataset.set, v = x.dataset.v; W[k] = x.dataset.toggle !== undefined && W[k] === v ? "" : v; if (k === "tipo") dlg.querySelector(".modal-head h2").textContent = original ? (v === "manutencao" ? "Editar manutenção" : "Editar obra") : (v === "manutencao" ? "Nova manutenção" : "Nova obra"); renderAll(); return; }
    if (t.closest("[data-add-item]")) { W.itens.push({ mat: "", qtd: null, unidade: "m²" }); renderAll(); return; }
    if ((x = t.closest("[data-rm-item]"))) { W.itens.splice(Number(x.dataset.rmItem), 1); renderAll(); return; }
    if ((x = t.closest("[data-assign-mode]"))) { if (x.dataset.assignMode === "team") { W._teamMode = true; } else { W._teamMode = false; W.equipeId = null; } renderAll(); return; }
    if ((x = t.closest("[data-inst]"))) { const id = x.dataset.inst, s = new Set(W.instaladorIds || []); s.has(id) ? s.delete(id) : s.add(id); W.instaladorIds = [...s]; W.equipeId = null; x.setAttribute("aria-pressed", String(s.has(id))); renderCheck(); return; }
    if (t.closest("[data-recommend]")) {
      if (!C.jobMaterials(W).length) { A.toast("Escolha o material na etapa Serviço para calcular sugestões.", true); return; }
      const probe = { ...W, id: original ? original.id : "__novo__", instaladorIds: [], equipeId: null };
      recState = C.recommend(probe, A.getCtx(), 3);
      $("#recBox", dlg).innerHTML = recHTML();
      return;
    }
    if ((x = t.closest("[data-pick]"))) {
      const cand = recState.candidatos[Number(x.dataset.pick)];
      if (cand.kind === "equipe") { W.equipeId = cand.id; W.instaladorIds = []; W._teamMode = true; } else { W.equipeId = null; W.instaladorIds = [...cand.members]; W._teamMode = false; }
      if (!W.agenda.inicio && cand.data) W.agenda.inicio = cand.data;
      W._recomendacao = { at: new Date().toISOString(), escolhido: cand.nome, score: cand.score, posicao: Number(x.dataset.pick) + 1 };
      renderAll(); A.toast(`${cand.nome} atribuído${W.agenda.inicio === cand.data ? ` para ${C.fmtDate(cand.data)}` : ""}.`);
      return;
    }
    if ((x = t.closest("[data-save]"))) save(x.dataset.save, x);
  });

  async function save(kind, btn) {
    if (!W.cliente.trim()) { step = 0; renderAll(); validateStep(1); return; }
    const c = A.getCtx();
    const body = JSON.parse(JSON.stringify(W));
    delete body._teamMode; delete body.id;
    const rec = body._recomendacao; delete body._recomendacao;
    if (kind === "draft") body.status = original && original.status !== "rascunho" ? original.status : "rascunho";
    else if (body.status === "rascunho") body.status = "agendada";
    if (!body.agenda.horasManual) body.agenda.horas = null;
    body.itens = body.itens.filter(i => i.mat);
    const est = C.estimateDuration(body, c);
    if (est.horas) body.estimativa = { horas: est.horas, origem: est.origem, at: new Date().toISOString() };
    let issues = [];
    if (kind === "confirm") {
      issues = C.validateJob({ ...body, id: original ? original.id : "__novo__" }, c);
      if (C.hasErrors(issues)) {
        if (step !== 4) { step = 4; renderAll(); A.toast("Existem conflitos de agenda. Revise antes de confirmar.", true); return; }
        const why = ($("#fWhy", dlg) || {}).value || "";
        if (why.trim().length < 5) { A.toast("Escreva uma justificativa para confirmar com conflito.", true); $("#fWhy", dlg).focus(); return; }
        body.overrides = [...(body.overrides || []), { at: new Date().toISOString(), por: A.S.uid || null, motivo: why.trim(), conflitos: issues.filter(i => i.severity === "erro").map(i => i.msg) }];
      }
    }
    const histTxt = original ? changeSummary(original, body) : (body.status === "rascunho" ? "Rascunho criado" : "Obra cadastrada");
    body.hist = [...(body.hist || []), { t: new Date().toISOString(), txt: histTxt + (rec ? ` · sugestão aceita: ${rec.escolhido} (${rec.score}/100, ${rec.posicao}º)` : "") }].slice(-40);
    btn.disabled = true;
    try {
      await A.Store.saveJob(original ? original.id : null, body, original ? { expectedAtualizado: original.atualizado } : {});
      A.toast(kind === "draft" ? "Rascunho salvo." : original ? "Alterações salvas." : "Obra criada e adicionada à agenda.");
      dlg.close();
    } catch (e) {
      if (e.code === "stale") {
        if (await A.confirmDialog("Outra pessoa alterou esta obra enquanto você editava. Salvar mesmo assim vai substituir as alterações dela.", "Substituir mesmo assim", true)) {
          await A.guard(() => A.Store.saveJob(original.id, body, { force: true }), "Alterações salvas.");
          dlg && dlg.close();
        }
      } else A.toast(e.message || "Não foi possível salvar.", true);
    } finally { if (btn) btn.disabled = false; }
  }
  function changeSummary(o, n) {
    const ch = [];
    if (o.status !== n.status) ch.push(`situação: ${(C.STATUS[n.status] || {}).label}`);
    if ((o.agenda || {}).inicio !== n.agenda.inicio) ch.push(`início: ${n.agenda.inicio ? C.fmtDate(n.agenda.inicio) : "sem data"}`);
    if ((o.instaladorIds || []).join() !== (n.instaladorIds || []).join() || o.equipeId !== n.equipeId) ch.push("instaladores alterados");
    if (JSON.stringify(o.itens) !== JSON.stringify(n.itens)) ch.push("materiais");
    return ch.length ? "Alterado: " + ch.join("; ") : "Dados atualizados";
  }
})();
