/* Team and management views: Instaladores, Desempenho, Configurações, Minha Agenda (installer), Quadro (viewer). */
(function () {
  "use strict";
  const A = window.App, C = A.C, Store = A.Store, S = A.S, { $, $$, h, ic, badge } = A;
  const ui = A.ui;
  ui.inst = { status: "" };
  ui.perf = { range: "30", inst: "" };

  /* =========================== INSTALADORES =========================== */
  A.views.instaladores = function (el) {
    const c = A.getCtx(), evs = c.events || [];
    const all = (c.installers || []).slice().sort((a, b) => (a.ativo === false) - (b.ativo === false) || a.nome.localeCompare(b.nome, "pt-BR"));
    const st = Object.fromEntries(all.map(i => [i.id, C.installerStatus(i, c, evs)]));
    const filters = [["", "Todos"], ["disponivel", "Disponíveis"], ["agendado", "Agendados"], ["deslocamento", "Em deslocamento"], ["em_obra", "Em obra"], ["pausado", "Pausados"], ["indisponivel", "Indisponíveis"], ["inativo", "Inativos"]];
    const match = i => !ui.inst.status || st[i.id].code === ui.inst.status || (ui.inst.status === "em_obra" && st[i.id].code === "em_obra_escritorio");
    const list = all.filter(match);
    el.innerHTML = `<div class="stack loose">${c.virtual ? A.migrationBanner() : ""}
      <div class="page-head"><div><h2 class="h-title">Instaladores</h2><p>Perfis permanentes com especialidades, produtividade, expediente e indisponibilidades. A situação “Em obra” só aparece como confirmada quando o próprio instalador faz o check-in no celular.</p></div>
        ${A.canEdit && !c.virtual ? `<div class="row wrap"><button class="btn" type="button" data-team-new>${ic("users", 16)}Nova equipe</button><button class="btn primary" type="button" data-inst-edit="">${ic("plus", 16)}Novo instalador</button></div>` : ""}</div>
      <div class="chip-row scroll">${filters.map(([k, l]) => `<button type="button" class="chip" data-inst-filter="${k}" aria-pressed="${ui.inst.status === k}">${l} <span class="n">${k ? all.filter(i => st[i.id].code === k || (k === "em_obra" && st[i.id].code === "em_obra_escritorio")).length : all.length}</span></button>`).join("")}</div>
      ${list.length ? `<div class="card-grid">${list.map(i => instCard(i, st[i.id], c)).join("")}</div>` : `<div class="card">${A.emptyHTML("hard-hat", all.length ? "Nenhum instalador nesta situação" : "Nenhum instalador cadastrado", all.length ? "" : "Cadastre cada instalador com os materiais que instala e o expediente.")}</div>`}
      <section class="stack"><div class="sec-head"><h2>${ic("users", 16)} Equipes</h2></div>
        ${(c.teams || []).length ? `<div class="card-grid">${c.teams.map(t => `<article class="card pad stack tight"><div class="row between"><b>${h(t.nome)}</b>${A.canEdit && !c.virtual ? `<button class="btn ghost sm" type="button" data-team-edit="${h(t.id)}">${ic("pen-line", 14)}Editar</button>` : ""}</div>
          <div class="row wrap" style="gap:5px">${t.membros.map(m => badge(m === t.lider ? "accent" : "neutral", A.instName(m) + (m === t.lider ? " · líder" : ""))).join("")}</div>
          <span class="tiny muted">Ao atribuir a equipe, o horário de todos os membros fica reservado.</span></article>`).join("")}</div>` : `<p class="small muted">Nenhuma equipe. Crie equipes para obras que precisam de mais de um instalador.</p>`}</section></div>`;
  };
  function instCard(i, st, c) {
    const wl = C.workload(i, c);
    const job = st.jobId && c.jobsById[st.jobId];
    const mats = Object.entries(i.materiais || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const last = st.lastEvent;
    return `<article class="card pad stack" style="gap:10px">
      <div class="row" style="gap:10px"><span class="avatar lg">${h(A.initials(i.nome))}</span><div class="grow stack" style="gap:2px"><b>${h(i.nome)}</b><span class="row wrap" style="gap:5px">${badge(st.tone, st.label, true)}${i.origem === "migracao" && !mats.length ? badge("warning", "Perfil incompleto") : ""}</span></div>
        ${A.canEdit && !c.virtual ? `<button class="btn ghost sm" type="button" data-inst-edit="${h(i.id)}">${ic("pen-line", 14)}Editar</button>` : ""}</div>
      <div class="small">${job ? `Obra: <button type="button" class="btn ghost sm" style="padding:0;min-height:0;height:auto" data-open="${h(job.id)}"><b>${h(job.cliente)}</b></button>${job.endereco && job.endereco.bairro ? ` · ${h(job.endereco.bairro)}` : ""}` : `<span class="muted">${st.code === "indisponivel" ? h(st.motivo || "Indisponível hoje") : "Sem obra hoje"}</span>`}</div>
      <div class="tiny ${st.confirmed ? "" : "muted"}">${st.confirmed ? `Confirmado pelo instalador em ${h(C.fmtTs(st.since))}` : last ? `Última atualização: ${h(C.fmtTs(last.at))} · localização não confirmada` : "Sem check-in registrado · localização não confirmada"}</div>
      <div class="stack tight"><div class="row between tiny"><span>Carga desta semana</span><span class="mono">${C.fmtNum(wl.ocupadoH)} h de ${C.fmtNum(wl.capacidadeH)} h · ${wl.pct}%</span></div>
        <div class="progress ${wl.level}"><span style="width:${Math.min(100, wl.pct)}%"></span></div>
        <span class="tiny muted">${{ ocioso: "Com folga", equilibrado: "Equilibrado", cheio: "Agenda cheia", sobrecarregado: "Sobrecarregado" }[wl.level]}${wl.proximaVaga ? ` · próxima vaga (3 h+): ${A.relDay(wl.proximaVaga, c.today).toLowerCase()}` : ""}</span></div>
      <div class="row wrap" style="gap:5px">${mats.slice(0, 5).map(([m, v]) => badge(v >= 4 ? "accent" : "neutral", `${(C.MAT[m] || {}).label || m} ${"★".repeat(v)}`)).join("") || `<span class="tiny" style="color:var(--warning-text)">Nenhum material cadastrado — não aparece nas sugestões.</span>`}${mats.length > 5 ? badge("neutral", `+${mats.length - 5}`) : ""}</div>
    </article>`;
  }

  function impactOf(changeFn) {
    const c = A.getCtx();
    const before = C.validateAll(c);
    const data = changeFn({ cfg: c.cfg, installers: c.installers.map(i => ({ ...i })), teams: (c.teams || []).map(t => ({ ...t })), jobs: c.jobs.map(j => { const x = { ...j }; delete x._members; return x; }) });
    const after = C.validateAll(C.buildContext(data, new Date()));
    return Object.keys(after).filter(id => C.hasErrors(after[id]) && !(before[id] && C.hasErrors(before[id]))).map(id => ({ job: c.jobsById[id], issues: after[id].filter(i => i.severity === "erro") }));
  }

  function instEditor(id) {
    const c = A.getCtx();
    const orig = id ? c.installersById[id] : null;
    const I = orig ? JSON.parse(JSON.stringify(orig)) : { nome: "", fone: "", ativo: true, materiais: {}, produtividade: {}, fazManutencao: true, lider: false, semana: null, bloqueios: [], bairros: [], notas: "" };
    I.materiais = I.materiais || {}; I.produtividade = I.produtividade || {}; I.bloqueios = I.bloqueios || [];
    let tab = "dados";
    const d = A.openDialog({ title: orig ? `Editar ${orig.nome}` : "Novo instalador", wide: true, body: "", foot: `${orig ? `<button class="btn danger-outline" type="button" data-inst-toggle>${orig.ativo === false ? "Reativar" : "Desativar"}</button><span class="spacer"></span>` : ""}<button class="btn" data-x type="button">Cancelar</button><button class="btn primary" type="button" data-inst-save>Salvar</button>` });
    const draw = () => {
      const perf = orig ? C.performance(c, C.addDays(c.today, -90), c.today).find(r => r.id === orig.id) : null;
      const week = I.semana || c.cfg.week;
      $(".modal-body", d).innerHTML = `<div class="stack">
        <div class="segmented" role="group" aria-label="Seções">${[["dados", "Dados"], ["esp", "Especialidades"], ["disp", "Disponibilidade"], ["perf", "Desempenho"]].map(([k, l]) => `<button type="button" data-itab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div>
        ${tab === "dados" ? `<div class="form-grid">
          <div class="field span-4"><label for="iNome">Nome completo *</label><input class="input" id="iNome" data-f="nome" value="${h(I.nome)}"></div>
          <div class="field span-2"><label for="iFone">WhatsApp</label><input class="input" id="iFone" data-f="fone" type="tel" value="${h(I.fone || "")}"></div>
          <div class="field span-3"><label for="iBairro">Bairro principal de atuação</label><input class="input" id="iBairro" data-f="bairroPrincipal" value="${h(I.bairroPrincipal || "")}"></div>
          <div class="field span-3"><label for="iAreas">Áreas de atendimento</label><input class="input" id="iAreas" data-f="areas" value="${h((I.bairros || []).join(", "))}" placeholder="Zona Sul, Ponta Negra…"></div>
          <div class="field span-6"><label for="iBase">Ponto de partida (opcional)</label><input class="input" id="iBase" placeholder="Link do Google Maps ou -3.10, -60.02" value="${C.hasCoords(I.base) ? `${I.base.lat}, ${I.base.lng}` : ""}"><span class="hint">Usado na proximidade só quando o instalador não tem outra obra no dia.</span></div>
          <div class="field span-6"><label class="check"><input type="checkbox" data-fb="fazManutencao" ${I.fazManutencao !== false ? "checked" : ""}> Faz manutenções</label><label class="check"><input type="checkbox" data-fb="lider" ${I.lider ? "checked" : ""}> Pode liderar equipes</label></div>
          <div class="field span-6"><label for="iNotas">Observações</label><textarea class="textarea" id="iNotas" data-f="notas">${h(I.notas || "")}</textarea></div></div>`
        : tab === "esp" ? `<p class="small muted">Nota de 1 a 5 em cada material que a pessoa instala (sem nota = não instala). Produtividade é por pessoa e por dia; deixe em branco para usar o histórico real ou o valor de referência.</p>
          <div class="card table-wrap"><table class="table"><thead><tr><th>Material</th><th>Experiência</th><th>Produtividade / dia</th></tr></thead><tbody>${C.MATERIALS.filter(m => m.id !== "outro").map(m => `<tr><td>${h(m.label)}</td><td><div class="rating" role="group" aria-label="Experiência em ${h(m.label)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-rate="${m.id}|${n}" aria-pressed="${(I.materiais[m.id] || 0) >= n}">${n}</button>`).join("")}${I.materiais[m.id] ? `<button type="button" data-rate="${m.id}|0" title="Não instala" aria-label="Remover">${ic("x", 12)}</button>` : ""}</div></td>
            <td><div class="row"><input class="input sm" type="number" min="0" step="0.5" data-prod="${m.id}" value="${h(I.produtividade[m.id] || "")}" placeholder="${h(c.cfg.productivity[m.id] || "")}" style="width:90px"><span class="tiny muted">${m.unit}</span></div></td></tr>`).join("")}</tbody></table></div>`
        : tab === "disp" ? `<label class="check"><input type="checkbox" id="iOwnWeek" ${I.semana ? "checked" : ""}> Horário próprio (diferente do expediente da empresa)</label>
          <div class="card table-wrap"><table class="table"><thead><tr><th>Dia</th><th>Trabalha</th><th>Início</th><th>Fim</th><th>Intervalo (min)</th></tr></thead><tbody>${[1, 2, 3, 4, 5, 6, 0].map(k => { const w = week[k] || { on: false }; const dis = I.semana ? "" : "disabled"; return `<tr><td>${C.DOW_PT[k]}</td><td><input type="checkbox" data-wk="${k}|on" ${w.on ? "checked" : ""} ${dis}></td><td><input class="input sm" type="time" data-wk="${k}|start" value="${h(w.start || "08:00")}" ${dis}></td><td><input class="input sm" type="time" data-wk="${k}|end" value="${h(w.end || "17:00")}" ${dis}></td><td><input class="input sm" type="number" min="0" step="15" data-wk="${k}|breakMin" value="${h(w.breakMin || 0)}" style="width:80px" ${dis}></td></tr>`; }).join("")}</tbody></table></div>
          <section class="stack tight"><h3 class="h-section">Férias, folgas e indisponibilidades</h3>
            ${I.bloqueios.length ? `<div class="card"><div class="rows">${I.bloqueios.map((b, k) => `<div class="rowitem" style="cursor:default"><span class="grow small"><b>${h({ ferias: "Férias", folga: "Folga", indisponivel: "Indisponível" }[b.tipo] || b.tipo)}</b> · ${C.fmtDate(b.de)}${b.ate && b.ate !== b.de ? " a " + C.fmtDate(b.ate) : ""}${b.motivo ? " · " + h(b.motivo) : ""}</span><button class="btn ghost icon sm" type="button" data-rm-blk="${k}" aria-label="Remover">${ic("x", 14)}</button></div>`).join("")}</div></div>` : `<p class="small muted">Nenhuma registrada.</p>`}
            <div class="row wrap"><select class="select sm" id="bTipo" style="width:auto"><option value="ferias">Férias</option><option value="folga">Folga</option><option value="indisponivel">Indisponível</option></select><input class="input sm" type="date" id="bDe" style="width:auto" aria-label="De"><input class="input sm" type="date" id="bAte" style="width:auto" aria-label="Até"><input class="input sm" id="bMot" placeholder="Motivo (opcional)" style="width:auto;flex:1 1 160px"><button class="btn sm" type="button" data-add-blk>${ic("plus", 14)}Adicionar</button></div></section>`
        : `<div class="stack">${perf ? `<div class="stats">${[["Concluídas (90 dias)", perf.concluidas], ["No prazo", perf.noPrazoPct == null ? "—" : perf.noPrazoPct + "%"], ["Dias agendados", perf.diasAgendados], ["Capacidade ociosa", perf.ociosidadePct == null ? "—" : perf.ociosidadePct + "%"]].map(([l, v]) => `<div class="stat" style="cursor:default"><span><span class="stat-value">${v}</span><span class="stat-label" style="display:block">${l}</span></span></div>`).join("")}</div>
            <p class="small muted">Atrasos por motivo: ${Object.keys(perf.causas).length ? Object.entries(perf.causas).map(([k, n]) => `${C.DELAY_CAUSES[k] || "não informado"}: ${n}`).join(" · ") : "nenhum"}. Retrabalhos: ${perf.retrabalhos}.</p>` : `<p class="small muted">Salve o instalador para acompanhar o desempenho.</p>`}</div>`}
      </div>`;
    };
    draw();
    d.addEventListener("input", e => {
      const t = e.target;
      if (t.dataset.f) { if (t.dataset.f === "areas") I.bairros = t.value.split(",").map(s => s.trim()).filter(Boolean); else I[t.dataset.f] = t.value; }
      if (t.dataset.prod) { const v = Number(t.value); if (v > 0) I.produtividade[t.dataset.prod] = v; else delete I.produtividade[t.dataset.prod]; }
      if (t.dataset.wk) { const [k, f] = t.dataset.wk.split("|"); I.semana[k] = I.semana[k] || {}; I.semana[k][f] = f === "on" ? t.checked : f === "breakMin" ? Number(t.value) || 0 : t.value; }
    });
    d.addEventListener("change", e => {
      const t = e.target;
      if (t.dataset.fb) I[t.dataset.fb] = t.checked;
      if (t.id === "iOwnWeek") { I.semana = t.checked ? JSON.parse(JSON.stringify(c.cfg.week)) : null; draw(); }
      if (t.id === "iBase") { const p = C.parseCoords(t.value); I.base = p ? { lat: p.lat, lng: p.lng } : null; if (t.value && !p) A.toast("Não reconheci coordenadas no ponto de partida.", true); }
      if (t.dataset.wk && t.type === "checkbox") { const [k] = t.dataset.wk.split("|"); I.semana[k] = I.semana[k] || {}; I.semana[k].on = t.checked; }
    });
    d.addEventListener("click", async e => {
      const t = e.target; let x;
      if ((x = t.closest("[data-itab]"))) { tab = x.dataset.itab; draw(); return; }
      if ((x = t.closest("[data-rate]"))) { const [m, n] = x.dataset.rate.split("|"); if (+n) I.materiais[m] = +n; else delete I.materiais[m]; draw(); return; }
      if ((x = t.closest("[data-rm-blk]"))) { I.bloqueios.splice(+x.dataset.rmBlk, 1); draw(); return; }
      if (t.closest("[data-add-blk]")) {
        const de = $("#bDe", d).value, ate = $("#bAte", d).value || de;
        if (!de) return A.toast("Informe a data inicial.", true);
        if (ate < de) return A.toast("A data final está antes da inicial.", true);
        I.bloqueios.push({ tipo: $("#bTipo", d).value, de, ate, motivo: $("#bMot", d).value.trim() }); draw(); return;
      }
      if (t.closest("[data-inst-toggle]")) { I.ativo = orig.ativo === false; return save(true); }
      if (t.closest("[data-inst-save]")) return save();
    });
    async function save(toggled) {
      if (!I.nome.trim()) { tab = "dados"; draw(); return A.toast("Informe o nome do instalador.", true); }
      const body = { ...I, nome: I.nome.trim() };
      delete body.id; delete body._members;
      const sid = id || "__novo__";
      const impact = impactOf(data => ({ ...data, installers: data.installers.filter(x => x.id !== sid).concat([{ ...body, id: sid }]) }));
      if (impact.length && !(await A.confirmDialog(`Esta alteração cria conflito em ${impact.length} obra(s): ${impact.slice(0, 4).map(x => `${x.job.cliente} (${x.issues[0].msg})`).join("; ")}${impact.length > 4 ? "…" : ""}. As obras ficarão marcadas com alerta para remanejar. Salvar mesmo assim?`, "Salvar e revisar obras"))) return;
      await A.guard(() => Store.saveInstaller(id || null, body), toggled ? (body.ativo === false ? "Instalador desativado." : "Instalador reativado.") : "Instalador salvo.");
      d.close();
    }
  }

  function teamEditor(id) {
    const c = A.getCtx(), orig = id ? (c.teams || []).find(t => t.id === id) : null;
    const T = orig ? JSON.parse(JSON.stringify(orig)) : { nome: "", membros: [], lider: null };
    const d = A.openDialog({ title: orig ? "Editar equipe" : "Nova equipe", body: "", foot: `${orig ? `<button class="btn danger-outline" type="button" data-team-del>Excluir equipe</button><span class="spacer"></span>` : ""}<button class="btn" data-x type="button">Cancelar</button><button class="btn primary" type="button" data-team-save>Salvar</button>` });
    const draw = () => { $(".modal-body", d).innerHTML = `<div class="stack"><div class="field"><label for="tNome">Nome da equipe *</label><input class="input" id="tNome" value="${h(T.nome)}"></div>
      <div class="field"><span class="label">Membros</span><div class="chip-row">${(c.installers || []).filter(i => i.ativo !== false).map(i => `<button type="button" class="chip" data-tm="${h(i.id)}" aria-pressed="${T.membros.includes(i.id)}">${h(i.nome)}</button>`).join("")}</div></div>
      <div class="field"><label for="tLider">Líder</label><select class="select" id="tLider"><option value="">—</option>${T.membros.map(m => `<option value="${h(m)}" ${T.lider === m ? "selected" : ""}>${h(A.instName(m))}</option>`).join("")}</select></div></div>`; };
    draw();
    d.addEventListener("input", e => { if (e.target.id === "tNome") T.nome = e.target.value; if (e.target.id === "tLider") T.lider = e.target.value || null; });
    d.addEventListener("click", async e => {
      let x;
      if ((x = e.target.closest("[data-tm]"))) { const m = x.dataset.tm; T.membros = T.membros.includes(m) ? T.membros.filter(y => y !== m) : [...T.membros, m]; if (!T.membros.includes(T.lider)) T.lider = null; T.nome = $("#tNome", d).value; draw(); return; }
      if (e.target.closest("[data-team-del]")) {
        const used = c.jobs.filter(j => j.equipeId === id && !["concluida", "cancelada"].includes(j.status));
        if (used.length) return A.toast(`A equipe está em ${used.length} obra(s) em aberto. Troque a atribuição dessas obras antes de excluir.`, true);
        if (await A.confirmDialog(`Excluir a equipe ${T.nome}?`, "Excluir", true)) { await A.guard(() => Store.deleteTeam(id), "Equipe excluída."); d.close(); }
        return;
      }
      if (e.target.closest("[data-team-save]")) {
        T.nome = $("#tNome", d).value.trim();
        if (!T.nome || T.membros.length < 2) return A.toast("Dê um nome e escolha pelo menos dois membros.", true);
        const sid = id || "__nova__";
        const impact = impactOf(data => ({ ...data, teams: data.teams.filter(t => t.id !== sid).concat([{ ...T, id: sid }]) }));
        if (impact.length && !(await A.confirmDialog(`Com estes membros, ${impact.length} obra(s) da equipe passam a ter conflito: ${impact.slice(0, 3).map(x => x.job.cliente).join(", ")}. Salvar mesmo assim?`, "Salvar"))) return;
        const body = { ...T }; delete body.id;
        await A.guard(() => Store.saveTeam(id || null, body), "Equipe salva.");
        d.close();
      }
    });
  }

  /* =========================== DESEMPENHO =========================== */
  A.views.desempenho = function (el) {
    const c = A.getCtx(), st = ui.perf;
    const to = c.today, from = st.range === "mes" ? to.slice(0, 8) + "01" : C.addDays(to, -(Number(st.range) - 1));
    const rows = C.performance(c, from, to).filter(r => !st.inst || r.id === st.inst);
    const prodTxt = r => r.produtividade ? Object.entries(r.produtividade.reduce((acc, x) => { (acc[x.mat] = acc[x.mat] || []).push(x.rate); return acc; }, {})).map(([m, l]) => `${(C.MAT[m] || {}).label}: ${C.fmtNum(l.reduce((a, b) => a + b, 0) / l.length)} ${(C.MAT[m] || {}).unit}/dia`).join("; ") : "—";
    el.innerHTML = `<div class="stack loose">
      <div class="page-head"><div><h2 class="h-title">Desempenho da Equipe</h2><p>Período de ${C.fmtDate(from)} a ${C.fmtDate(to)}. Atrasos causados por falta de material, cliente ou acesso ao local aparecem separados e não contam como atraso do instalador.</p></div>
        <div class="row wrap"><div class="segmented" role="group" aria-label="Período">${[["30", "30 dias"], ["mes", "Este mês"], ["90", "90 dias"], ["365", "12 meses"]].map(([k, l]) => `<button type="button" data-prange="${k}" aria-pressed="${st.range === k}">${l}</button>`).join("")}</div>
        <select class="select sm" id="pfInst" style="width:auto" aria-label="Instalador"><option value="">Todos</option>${(c.installers || []).map(i => `<option value="${h(i.id)}" ${st.inst === i.id ? "selected" : ""}>${h(i.nome)}</option>`).join("")}</select>
        ${Store.hasDownloads() ? `<button class="btn sm" type="button" data-perf-csv>${ic("download", 15)}CSV</button>` : ""}</div></div>
      ${rows.length ? `<div class="card table-wrap"><table class="table responsive"><thead><tr><th>Instalador</th><th>Concluídas</th><th>No prazo</th><th>Atrasos (instalador / total)</th><th>Dias previstos × reais</th><th>Produtividade real</th><th>Dias agendados</th><th>Capacidade ociosa</th><th>Retrabalhos</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="cell-title">${h(r.nome)}</td><td data-label="Concluídas" class="mono">${r.concluidas}</td><td data-label="No prazo" class="mono">${r.noPrazoPct == null ? "—" : r.noPrazoPct + "%"}</td><td data-label="Atrasos" class="mono" title="${h(Object.entries(r.causas).map(([k, n]) => `${C.DELAY_CAUSES[k] || "Motivo não informado"}: ${n}`).join("\n"))}">${r.atrasosInstalador} / ${r.atrasos}</td><td data-label="Previstos × reais" class="mono">${r.diasEstimados} × ${r.diasReais}</td><td data-label="Produtividade" class="small">${h(prodTxt(r))}</td><td data-label="Dias agendados" class="mono">${r.diasAgendados}</td><td data-label="Ociosa" class="mono">${r.ociosidadePct == null ? "—" : r.ociosidadePct + "%"}</td><td data-label="Retrabalhos" class="mono">${r.retrabalhos}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card">${A.emptyHTML("chart-column", "Sem instaladores para analisar")}</div>`}
      <details class="card pad"><summary class="small strong" style="cursor:pointer">Como cada número é calculado</summary><ul class="small muted" style="margin:10px 0 0;padding-left:18px">
        <li><b>Concluídas</b>: obras com término real no período.</li><li><b>No prazo</b>: término real até o término previsto pela agenda.</li>
        <li><b>Atrasos</b>: total de obras concluídas depois do previsto; “instalador” só quando o motivo registrado foi execução.</li>
        <li><b>Dias previstos × reais</b>: dias de trabalho reservados × dias úteis entre início e fim reais.</li>
        <li><b>Produtividade real</b>: quantidade ÷ dias reais ÷ número de instaladores, em obras de um único material com quantidade e unidade confirmadas.</li>
        <li><b>Capacidade ociosa</b>: horas de expediente sem obra reservada ÷ horas de expediente disponíveis (descontando folgas e férias).</li>
        <li><b>Retrabalhos</b>: manutenções marcadas como retrabalho e vinculadas a uma obra do instalador.</li></ul></details></div>`;
    $("#pfInst", el).addEventListener("change", e => { st.inst = e.target.value; A.views.desempenho(el); });
  };
  async function perfCsv() {
    const c = A.getCtx(), st = ui.perf, to = c.today, from = st.range === "mes" ? to.slice(0, 8) + "01" : C.addDays(to, -(Number(st.range) - 1));
    const rows = C.performance(c, from, to);
    const cell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["Instalador", "Concluídas", "No prazo (%)", "Atrasos totais", "Atrasos do instalador", "Dias previstos", "Dias reais", "Dias agendados", "Capacidade ociosa (%)", "Retrabalhos"].map(cell).join(";")];
    for (const r of rows) lines.push([r.nome, r.concluidas, r.noPrazoPct, r.atrasos, r.atrasosInstalador, r.diasEstimados, r.diasReais, r.diasAgendados, r.ociosidadePct, r.retrabalhos].map(cell).join(";"));
    try { await Store.saveFile(`desempenho-${from}-a-${to}.csv`, "﻿" + lines.join("\r\n")); } catch (e) { if (e && e.code === "no_downloads") A.toast(e.message, true); }
  }

  /* =========================== CONFIGURAÇÕES =========================== */
  A.views.ajustes = function (el) {
    const c = A.getCtx(), cfg = JSON.parse(JSON.stringify(c.cfg)), owner = S.role === "admin";
    const dis = owner ? "" : "disabled";
    const people = S.acessos.pessoas || [];
    el.innerHTML = `<div class="stack loose" style="max-width:980px">
      ${!owner ? `<div class="banner tone-info small">${ic("info", 16)}<span>Só o administrador (dono da página) altera estas configurações. Você está vendo os valores atuais.</span></div>` : ""}
      <section class="card"><div class="card-head"><h3 class="h-section">Dados e armazenamento</h3>${badge(S.mode === "db" ? "success" : "warning", S.mode === "db" ? "Compartilhado" : "Só neste navegador")}</div><div class="card-body stack small">
        <p>${h(Store.describeMode(S.mode).label)}</p>
        ${c.virtual ? A.migrationBanner() : S.migracao ? `<p class="muted">Dados atualizados para a versão 2 em ${h(C.fmtTs(S.migracao.at))}. Cópia de segurança da agenda antiga guardada${S.mode === "db" ? " na coleção “backups”" : " neste navegador"}.</p>` : ""}
        <div class="row wrap">${Store.hasDownloads() ? `<button class="btn sm" type="button" data-export="csv">${ic("download", 15)}Planilha de obras (CSV)</button><button class="btn sm" type="button" data-export="json">${ic("download", 15)}Cópia de segurança (JSON)</button>` : `<span class="muted">Downloads indisponíveis neste navegador.</span>`}</div></div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Acessos da equipe</h3></div><div class="card-body stack small">
        <p class="muted">A permissão é aplicada pelo banco de dados, não só pelos botões. Compartilhe a página (botão Compartilhar do claude.ai) e cadastre a pessoa aqui:</p>
        <ul class="muted" style="margin:0;padding-left:18px"><li><b>Administrador</b>: o dono da página — tudo, inclusive configurações e acessos.</li><li><b>Coordenador</b>: compartilhe como <b>Editor</b> — cria, agenda e atualiza obras, instaladores e equipes.</li><li><b>Instalador</b>: compartilhe como <b>Colaborador</b> e cadastre abaixo ligado ao perfil — vê só as próprias obras e registra início, pausa, conclusão e problemas.</li><li><b>Visualizador</b>: compartilhe como <b>Leitor</b> e cadastre abaixo — vê um quadro resumido, sem telefones nem endereços completos.</li></ul>
        <div class="card" style="overflow:hidden"><div class="rows" id="peopleList">${people.length ? people.map((p, k) => `<div class="rowitem" style="cursor:default;flex-wrap:wrap"><span class="grow small strong" data-person-name="${h(p.id)}">…</span>
          <select class="select sm" data-pp="${k}|papel" style="width:auto" ${dis}><option value="instalador" ${p.papel === "instalador" ? "selected" : ""}>Instalador</option><option value="visualizador" ${p.papel === "visualizador" ? "selected" : ""}>Visualizador</option></select>
          ${p.papel === "instalador" ? `<select class="select sm" data-pp="${k}|instaladorId" style="width:auto" ${dis}><option value="">Ligar ao perfil…</option>${(c.installers || []).map(i => `<option value="${h(i.id)}" ${p.instaladorId === i.id ? "selected" : ""}>${h(i.nome)}</option>`).join("")}</select>` : ""}
          ${owner ? `<button class="btn ghost icon sm" type="button" data-pp-rm="${k}" aria-label="Remover acesso">${ic("x", 14)}</button>` : ""}</div>`).join("") : `<div class="card-body muted">Nenhuma pessoa cadastrada.</div>`}</div></div>
        ${owner ? `<div class="field"><label for="ppSearch">Adicionar pessoa</label><input class="input" id="ppSearch" placeholder="Digite o nome ou e-mail" autocomplete="off"><div class="rows" id="ppResults"></div></div>` : ""}</div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Expediente da empresa</h3></div><div class="card-body stack small"><p class="muted">Base para distribuir obras de vários dias. Cada instalador pode ter horário próprio no perfil.</p>
        <div class="table-wrap"><table class="table"><thead><tr><th>Dia</th><th>Expediente</th><th>Início</th><th>Fim</th><th>Intervalo (min)</th></tr></thead><tbody>${[1, 2, 3, 4, 5, 6, 0].map(k => { const w = cfg.week[k]; return `<tr><td>${C.DOW_PT[k]}</td><td><input type="checkbox" data-cw="${k}|on" ${w.on ? "checked" : ""} ${dis}></td><td><input class="input sm" type="time" data-cw="${k}|start" value="${h(w.start)}" ${dis}></td><td><input class="input sm" type="time" data-cw="${k}|end" value="${h(w.end)}" ${dis}></td><td><input class="input sm" type="number" min="0" step="15" data-cw="${k}|breakMin" value="${h(w.breakMin)}" style="width:80px" ${dis}></td></tr>`; }).join("")}</tbody></table></div></div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Feriados e dias sem expediente</h3><span class="small muted">${cfg.holidays.length}</span></div><div class="card-body stack small"><p class="muted">Lista inicial com feriados nacionais, do Amazonas e de Manaus — revise pontos facultativos.</p>
        <div class="row wrap" style="gap:6px">${cfg.holidays.filter(x => x.date >= C.addDays(c.today, -31)).map((x, k) => `<span class="badge tone-neutral" title="${h(x.nome)}">${C.fmtDate(x.date)} · ${h(x.nome)}${owner ? ` <button type="button" class="btn ghost icon sm" style="width:18px;min-height:18px;height:18px" data-hol-rm="${h(x.date)}" aria-label="Remover">${ic("x", 11)}</button>` : ""}</span>`).join("")}</div>
        ${owner ? `<div class="row wrap"><input class="input sm" type="date" id="holD" style="width:auto"><input class="input sm" id="holN" placeholder="Nome" style="width:auto;flex:1 1 200px"><button class="btn sm" type="button" data-hol-add>${ic("plus", 14)}Adicionar</button></div>` : ""}</div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Produtividade de referência (por instalador, por dia)</h3></div><div class="card-body stack small"><p class="muted">Usada só quando o instalador não tem produtividade no perfil nem histórico suficiente. Sempre aparece marcada como “referência” nas estimativas.</p>
        <div class="row wrap" style="gap:10px">${C.MATERIALS.filter(m => m.id !== "outro").map(m => `<label class="stack tight" style="width:170px"><span class="tiny">${h(m.label)}</span><span class="row"><input class="input sm" type="number" min="0" step="0.5" data-cp="${m.id}" value="${h(cfg.productivity[m.id] || "")}" ${dis}><span class="tiny muted">${m.unit}</span></span></label>`).join("")}</div>
        <div class="row wrap" style="gap:10px"><label class="stack tight"><span class="tiny">Horas de trabalho por dia</span><input class="input sm" type="number" min="1" max="12" step="0.5" data-cn="hoursPerDay" value="${h(cfg.hoursPerDay)}" ${dis}></label><label class="stack tight"><span class="tiny">Preparação + acabamento (h por obra)</span><input class="input sm" type="number" min="0" step="0.5" data-cn="setupHours" value="${h(cfg.setupHours)}" ${dis}></label><label class="stack tight"><span class="tiny">Tempo reservado para deslocamento (min)</span><input class="input sm" type="number" min="0" step="5" data-cn="travelBufferMin" value="${h(cfg.travelBufferMin)}" ${dis}></label></div></div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Prontidão obrigatória</h3></div><div class="card-body stack small">${["instalacao", "manutencao"].map(t => `<div class="row wrap"><b style="width:110px">${t === "instalacao" ? "Instalação" : "Manutenção"}</b>${C.READINESS.map(r => `<label class="check"><input type="checkbox" data-rq="${t}|${r.id}" ${(cfg.readinessRequired[t] || []).includes(r.id) ? "checked" : ""} ${dis}> ${h(r.label)}</label>`).join("")}</div>`).join("")}</div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Pesos da recomendação</h3><span class="small muted" id="wSum"></span></div><div class="card-body row wrap small" style="gap:12px">${[["expertise", "Especialidade"], ["availability", "Disponibilidade"], ["proximity", "Proximidade"], ["productivity", "Produtividade"], ["history", "Histórico"]].map(([k, l]) => `<label class="stack tight" style="width:140px"><span class="tiny">${l} (%)</span><input class="input sm" type="number" min="0" max="100" data-cwt="${k}" value="${h(cfg.weights[k])}" ${dis}></label>`).join("")}</div></section>
      ${owner ? `<div class="row end"><button class="btn primary" type="button" data-cfg-save>${ic("check", 16)}Salvar configurações</button></div>` : ""}</div>`;
    // people names (resolved per render, never stored)
    Store.profiles(people.map(p => p.id)).then(ps => { for (const p of people) { const n = $(`[data-person-name="${CSS.escape(p.id)}"]`, el); if (n) n.textContent = (ps[p.id] && ps[p.id].name) || "Pessoa sem nome visível"; } });
    const sum = () => { const s = Object.values(cfg.weights).reduce((a, b) => a + Number(b || 0), 0); $("#wSum", el).textContent = `Soma: ${s}%${s !== 100 ? " (é normalizada automaticamente)" : ""}`; };
    sum();
    el.oninput = e => {
      const t = e.target;
      if (t.dataset.cw) { const [k, f] = t.dataset.cw.split("|"); cfg.week[k][f] = f === "on" ? t.checked : f === "breakMin" ? Number(t.value) || 0 : t.value; }
      if (t.dataset.cp) { const v = Number(t.value); if (v > 0) cfg.productivity[t.dataset.cp] = v; else delete cfg.productivity[t.dataset.cp]; }
      if (t.dataset.cn) cfg[t.dataset.cn] = Number(t.value) || 0;
      if (t.dataset.cwt) { cfg.weights[t.dataset.cwt] = Number(t.value) || 0; sum(); }
      if (t.id === "ppSearch") Store.searchPeople(t.value).then(hits => { $("#ppResults", el).innerHTML = hits.filter(x => !people.some(p => p.id === x.id)).map(x => `<div class="rowitem" style="cursor:default"><span class="grow small" data-hit-name></span><button class="btn sm" type="button" data-pp-add="${h(x.id)}|instalador">Instalador</button><button class="btn sm" type="button" data-pp-add="${h(x.id)}|visualizador">Visualizador</button></div>`).join("") || (t.value ? `<p class="tiny muted">Ninguém encontrado. A pessoa precisa ser da sua organização no claude.ai.</p>` : ""); $$("[data-hit-name]", el).forEach((n, k) => n.textContent = hits.filter(x => !people.some(p => p.id === x.id))[k].name); });
    };
    el.onchange = async e => {
      const t = e.target;
      if (t.dataset.cw && t.type === "checkbox") { const [k] = t.dataset.cw.split("|"); cfg.week[k].on = t.checked; }
      if (t.dataset.rq) { const [tp, r] = t.dataset.rq.split("|"); const s = new Set(cfg.readinessRequired[tp] || []); t.checked ? s.add(r) : s.delete(r); cfg.readinessRequired[tp] = [...s]; }
      if (t.dataset.pp) { const [k, f] = t.dataset.pp.split("|"); const next = people.map(p => ({ ...p })); next[k][f] = t.value; if (f === "papel" && t.value !== "instalador") delete next[k].instaladorId; await A.guard(() => Store.saveAcessos({ pessoas: next }), "Acesso atualizado."); }
    };
    el.onclick = async e => {
      const t = e.target; let x;
      if ((x = t.closest("[data-pp-add]"))) { const [id, papel] = x.dataset.ppAdd.split("|"); await A.guard(() => Store.saveAcessos({ pessoas: [...people, { id, papel }] }), papel === "instalador" ? "Pessoa adicionada. Agora ligue ao perfil do instalador." : "Pessoa adicionada."); return; }
      if ((x = t.closest("[data-pp-rm]"))) { const p = people[+x.dataset.ppRm]; if (await A.confirmDialog("Remover o acesso desta pessoa à agenda?", "Remover", true)) { await A.guard(() => Store.saveAcessos({ pessoas: people.filter(q => q !== p) }), "Acesso removido."); await Store.removeProjection(p.id).catch(() => { }); } return; }
      if ((x = t.closest("[data-hol-rm]"))) { cfg.holidays = cfg.holidays.filter(y => y.date !== x.dataset.holRm); await A.guard(() => Store.saveCfg(cfg), "Feriado removido."); return; }
      if (t.closest("[data-hol-add]")) { const dd = $("#holD", el).value, n = $("#holN", el).value.trim(); if (!dd || !n) return A.toast("Informe data e nome.", true); cfg.holidays = [...cfg.holidays.filter(y => y.date !== dd), { date: dd, nome: n }].sort((a, b) => a.date.localeCompare(b.date)); await A.guard(() => Store.saveCfg(cfg), "Feriado adicionado."); return; }
      if (t.closest("[data-cfg-save]")) {
        const impact = impactOf(data => ({ ...data, cfg }));
        if (impact.length && !(await A.confirmDialog(`Com estas configurações, ${impact.length} obra(s) passam a ter conflito (ex.: ${impact.slice(0, 3).map(i => i.job.cliente).join(", ")}). Salvar mesmo assim?`, "Salvar"))) return;
        await A.guard(() => Store.saveCfg(cfg), "Configurações salvas.");
      }
    };
  };

  /* migration (owner only) */
  async function migrationDialog() {
    const legacy = S.jobs.filter(j => j.v !== 2);
    const plan = C.planMigration(legacy, { installers: S.installers, teams: S.teams });
    const r = plan.report;
    const d = A.openDialog({
      title: "Atualizar dados para a nova agenda", wide: true,
      body: `<div class="stack small"><p>Nada é apagado. Antes de qualquer mudança, uma cópia completa das ${legacy.length} obras antigas é guardada${S.mode === "db" ? " na coleção “backups” do banco" : " neste navegador"}. Os identificadores das obras não mudam.</p>
        <div class="card pad stack tight"><b>O que será criado</b>
          <div>Perfis de instalador (${r.pessoas.length}): ${h(r.pessoas.join(", ") || "nenhum")}. Nomes iguais com maiúsculas/acentos diferentes são a mesma pessoa; nada além disso é juntado.</div>
          <div>Equipes (${r.equipes.length}): ${h(r.equipes.join(", ") || "nenhuma")} — criadas quando o campo tinha dois nomes (ex.: “SONY E VANDER”).</div>
          <div>Obras convertidas: ${r.obras}. Materiais escritos à mão viram itens da lista; quantidades com número são aproveitadas e a unidade fica “a confirmar” quando não estava escrita.</div>
          ${r.materiaisNaoReconhecidos.length ? `<div style="color:var(--warning-text)">Materiais não reconhecidos (ficam como “Outro material”, com o texto original): ${h([...new Set(r.materiaisNaoReconhecidos)].join("; "))}</div>` : ""}
          <div>Cada instalador recebe nota 3 (“experiência registrada”) nos materiais que já executou nas obras antigas. Revise notas e produtividade no perfil depois.</div></div></div>`,
      foot: `<button class="btn" data-x type="button">Agora não</button><button class="btn primary" type="button" id="migOk">${ic("check", 16)}Guardar cópia e atualizar</button>`
    });
    $("#migOk", d).addEventListener("click", async () => {
      $("#migOk", d).disabled = true;
      try { await A.guard(() => Store.runMigration(plan, legacy), "Dados atualizados. A cópia de segurança foi guardada."); d.close(); }
      catch (e) { $("#migOk", d).disabled = false; }
    });
  }

  async function exportData(kind) {
    const c = A.getCtx();
    try {
      if (kind === "json") return await Store.saveFile(`agenda-obras-copia-${c.today}.json`, JSON.stringify({ versao: 2, exportado: new Date().toISOString(), cfg: S.cfg, instaladores: S.installers, equipes: S.teams, obras: S.jobs }, null, 2));
      const cell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const head = ["Tipo", "Cliente", "WhatsApp", "Endereço", "Bairro", "Serviço", "Materiais", "Instaladores", "Início", "Horário", "Término previsto", "Horas", "Situação", "Urgência", "Prontidão", "Início real", "Fim real", "Instruções"];
      const lines = [head.map(cell).join(";")];
      for (const j of c.jobs.slice().sort((a, b) => String((a.agenda || {}).inicio || "9999").localeCompare(String((b.agenda || {}).inicio || "9999")))) {
        const al = C.allocate(j, c), rd = C.readiness(j, c);
        lines.push([j.tipo === "manutencao" ? "Manutenção" : "Instalação", j.cliente, j.fone, (j.endereco || {}).completo, (j.endereco || {}).bairro, j.servico, A.matsLabel(j), A.crewLabel(j, c), C.fmtDate((j.agenda || {}).inicio), (j.agenda || {}).hora, C.fmtDate(al.fim), al.horas, (C.STATUS[j.status] || {}).label, (C.PRIORITY[j.prio] || {}).label, { pronta: "Pronta", pendente: "Pendente", bloqueada: "Bloqueada", na: "" }[rd.state], j.real && j.real.inicio ? C.fmtTs(j.real.inicio) : "", j.real && j.real.fim ? C.fmtTs(j.real.fim) : "", j.obs].map(cell).join(";"));
      }
      await Store.saveFile(`agenda-obras-${c.today}.csv`, "﻿" + lines.join("\r\n"));
    } catch (e) { if (e && e.code === "no_downloads") A.toast(e.message, true); }
  }

  /* =========================== MINHA AGENDA (installer) =========================== */
  A.views.minhaAgenda = function (el) {
    const P = S.projection || { obras: [] };
    const t = C.today();
    const evs = ((S.campo[S.uid] || {}).eventos || []);
    const lastByJob = {};
    for (const e of evs) lastByJob[e.jobId] = e;
    const localStatus = j => { const e = lastByJob[j.id]; if (!e || (j.atualizado && false)) return j.status; return { inicio: "andamento", retomada: "andamento", pausa: "pausada", fim: "concluida", a_caminho: j.status === "agendada" ? "a_caminho" : j.status, problema: j.status }[e.tipo] || j.status; };
    const jobs = (P.obras || []).map(j => ({ ...j, st: localStatus(j) }));
    const openJobs = jobs.filter(j => j.st !== "concluida").sort((a, b) => String(a.agenda.inicio || "9999").localeCompare(String(b.agenda.inicio || "9999")));
    // Priority: in progress > on the way > scheduled for today > paused > next upcoming.
    const cur = openJobs.find(j => j.st === "andamento") || openJobs.find(j => j.st === "a_caminho") || openJobs.find(j => j.dias.some(d => d.d === t)) || openJobs.find(j => j.st === "pausada") || openJobs.find(j => j.agenda.inicio && j.dias.some(d => d.d >= t)) || openJobs[0];
    const done = jobs.filter(j => j.st === "concluida");
    let html = `<div class="field-wrap"><div class="stack tight"><span class="eyebrow">Olá, ${h(P.nome || "instalador")}</span><span class="small muted">Suas obras atribuídas. Os registros abaixo ficam com data e hora; a localização do celular não é coletada por este aplicativo.</span></div>`;
    if (!cur) html += `<div class="card">${A.emptyHTML("calendar-check", "Nenhuma obra atribuída a você", "Quando o escritório agendar uma obra para você, ela aparece aqui.")}</div>`;
    else {
      const e = cur.endereco || {}, todayBlk = cur.dias.find(d => d.d === t);
      const mapsUrl = C.hasCoords(e) ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}` : (e.completo || e.bairro || cur.bairro) ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([e.completo, e.bairro || cur.bairro, P.cidade].filter(Boolean).join(", "))}` : null;
      const wa = C.waLink(cur.fone, `Olá, ${cur.cliente}! Aqui é da equipe da Mercatto Decor.`);
      const eyebrow = cur.st === "andamento" ? "Obra em andamento" : cur.st === "pausada" ? "Obra pausada" : cur.st === "a_caminho" ? "A caminho" : cur.agenda.inicio === t ? "Obra de hoje" : cur.agenda.inicio ? `Próxima obra · ${A.relDay(cur.agenda.inicio, t)}` : "Próxima obra · sem data";
      const btn = (tipo, label, icon, cls) => `<button type="button" class="btn ${cls || ""} lg block" data-fev="${tipo}" data-job="${h(cur.id)}">${ic(icon, 20)}${label}</button>`;
      html += `<article class="next-card"><div class="next-head"><span class="eyebrow">${h(eyebrow)}</span><span class="nm">${h(cur.cliente)}</span><span class="sub">${h([e.completo || "", e.bairro || cur.bairro].filter(Boolean).join(" — ") || "Endereço não informado")}</span></div>
        <div class="next-body">
          ${todayBlk ? `<div class="small"><b>Hoje:</b> ${todayBlk.s}–${todayBlk.e}${cur.fimPrevisto ? ` · término previsto ${C.fmtDate(cur.fimPrevisto)}` : ""}</div>` : cur.fimPrevisto ? `<div class="small">Início ${C.fmtDate(cur.agenda.inicio)}${cur.agenda.hora ? " às " + cur.agenda.hora : ""} · término previsto ${C.fmtDate(cur.fimPrevisto)}</div>` : ""}
          ${cur.servico ? `<div class="small"><b>Serviço:</b> ${h(cur.servico)}</div>` : ""}
          <div class="small"><b>Material:</b> ${h((cur.itens || []).map(i => `${i.label || (C.MAT[i.mat] || {}).label}${i.qtd ? ` — ${C.fmtNum(i.qtd)} ${i.unidade || ""}` : ""}`).join("; ") || "não informado")}</div>
          ${cur.obs ? `<div class="banner tone-warning small">${ic("clipboard-list", 16)}<span style="white-space:pre-line">${h(cur.obs)}</span></div>` : ""}
          ${(cur.prontidao || []).length ? `<div class="banner tone-danger small">${ic("triangle-alert", 16)}<span>Pendente: ${h(cur.prontidao.join(", "))}. Confirme com o escritório.</span></div>` : ""}
          <div class="action-grid">${mapsUrl ? `<a class="action-tile" href="${h(mapsUrl)}" target="_blank" rel="noopener noreferrer">${ic("navigation", 22)}Navegar</a>` : `<span class="action-tile" aria-disabled="true">${ic("map-pin", 22)}Sem endereço</span>`}${wa ? `<a class="action-tile" href="${h(wa)}" target="_blank" rel="noopener noreferrer">${ic("message-circle", 22)}WhatsApp do cliente</a>` : `<span class="action-tile" aria-disabled="true">${ic("message-circle", 22)}Sem WhatsApp</span>`}</div>
          ${cur.st === "andamento" ? btn("fim", "Finalizar obra", "circle-check", "success") + btn("pausa", "Pausar obra", "pause") : cur.st === "pausada" ? btn("retomada", "Retomar obra", "play", "accent") : (cur.st === "a_caminho" ? "" : btn("a_caminho", "Estou a caminho", "truck")) + btn("inicio", "Iniciar obra", "play", "accent")}
          <button type="button" class="btn danger-outline block" data-fev="problema" data-job="${h(cur.id)}">${ic("triangle-alert", 16)}Informar problema</button>
          ${lastByJob[cur.id] ? `<p class="tiny muted">Último registro: ${h(A.EVENT_LABEL[lastByJob[cur.id].tipo] || lastByJob[cur.id].tipo)} em ${h(C.fmtTs(lastByJob[cur.id].at))}.</p>` : ""}
        </div></article>`;
    }
    const rest = openJobs.filter(j => j !== cur);
    if (rest.length) html += `<section class="stack tight"><h3 class="eyebrow">Próximas (${rest.length})</h3><div class="card"><div class="rows">${rest.map(j => `<div class="rowitem" style="cursor:default"><span class="grow stack" style="gap:1px"><b class="small">${h(j.cliente)}</b><span class="tiny muted">${h([j.agenda.inicio ? A.relDay(j.agenda.inicio, t) + (j.agenda.hora ? " " + j.agenda.hora : "") : "Sem data", j.bairro, (j.itens || [])[0] && ((j.itens[0].label) || (C.MAT[j.itens[0].mat] || {}).label)].filter(Boolean).join(" · "))}</span></span>${badge((C.STATUS[j.st] || C.STATUS.agendada).tone, (C.STATUS[j.st] || { label: "A caminho" }).label)}</div>`).join("")}</div></div></section>`;
    if (done.length) html += `<section class="stack tight"><h3 class="eyebrow">Concluídas recentemente</h3><div class="card"><div class="rows">${done.map(j => `<div class="rowitem" style="cursor:default"><span class="grow small">${h(j.cliente)}</span>${badge("success", "Concluída")}</div>`).join("")}</div></div></section>`;
    if (P.atualizado) html += `<p class="tiny faint">Agenda atualizada pelo escritório em ${h(C.fmtTs(P.atualizado + ":00.000Z"))}.</p>`;
    el.innerHTML = html + `</div>`;
  };
  function fieldEventDialog(tipo, jobId) {
    const P = S.projection || { obras: [] }, job = (P.obras || []).find(j => j.id === jobId);
    if (!job) return;
    if (tipo === "a_caminho" || tipo === "inicio" || tipo === "retomada") {
      return A.guard(() => Store.addFieldEvent({ tipo, jobId }), { a_caminho: "Registrado: a caminho.", inicio: "Obra iniciada. Bom trabalho!", retomada: "Obra retomada." }[tipo]);
    }
    const late = tipo === "fim" && job.fimPrevisto && job.fimPrevisto < C.today();
    const canPhoto = tipo === "fim" && Store.hasAssets();
    const d = A.openDialog({
      title: { pausa: "Pausar obra", fim: "Finalizar obra", problema: "Informar problema" }[tipo], sub: h(job.cliente),
      body: `<div class="stack">${tipo === "pausa" || late ? `<div class="field"><label for="feCausa">${tipo === "pausa" ? "Motivo da pausa *" : "A obra passou da data prevista. Motivo *"}</label><select class="select" id="feCausa"><option value="">Escolha…</option>${Object.entries(C.DELAY_CAUSES).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="feNota">${tipo === "problema" ? "O que aconteceu? *" : tipo === "fim" ? "Observações" : "Detalhes"}</label><textarea class="textarea" id="feNota"></textarea></div>
        ${tipo === "fim" ? `<div class="field"><label for="fePend">Ficou alguma pendência?</label><textarea class="textarea" id="fePend" placeholder="Deixe em branco se não ficou nada"></textarea></div>
        ${canPhoto ? `<div class="field"><label for="feFotos">Fotos (opcional)</label><input class="input" type="file" id="feFotos" accept="image/*" capture="environment" multiple><span class="hint">Até 6 fotos. São reduzidas antes do envio.</span></div>` : `<p class="tiny muted">O envio de fotos não está liberado para o seu acesso.</p>`}` : ""}
        <p class="small" id="feErr" style="color:var(--danger-text)" hidden></p></div>`,
      foot: `<button class="btn" data-x type="button">Cancelar</button><button class="btn ${tipo === "fim" ? "success" : "primary"}" type="button" id="feOk">${{ pausa: "Pausar", fim: "Finalizar obra", problema: "Enviar para o escritório" }[tipo]}</button>`
    });
    $("#feOk", d).addEventListener("click", async () => {
      const err = $("#feErr", d), causa = $("#feCausa", d) ? $("#feCausa", d).value : null, nota = $("#feNota", d).value.trim();
      if ((tipo === "pausa" || late) && !causa) { err.hidden = false; err.textContent = "Escolha o motivo."; return; }
      if (tipo === "problema" && nota.length < 3) { err.hidden = false; err.textContent = "Descreva o problema."; return; }
      $("#feOk", d).disabled = true;
      try {
        let fotos = [];
        const files = $("#feFotos", d) ? [...$("#feFotos", d).files].slice(0, 6) : [];
        for (const f of files) { err.hidden = false; err.style.color = "var(--text-2)"; err.textContent = `Enviando foto ${fotos.length + 1} de ${files.length}…`; fotos.push(await Store.uploadPhoto(f)); }
        await Store.addFieldEvent({ tipo, jobId, nota: causa ? `${C.DELAY_CAUSES[causa]}${nota ? ": " + nota : ""}` : nota, causa, pendencias: tipo === "fim" ? $("#fePend", d).value.trim() : undefined, fotos });
        A.toast({ pausa: "Pausa registrada.", fim: "Obra finalizada. Obrigado!", problema: "Problema enviado ao escritório." }[tipo]);
        d.close();
      } catch (e) { err.hidden = false; err.style.color = "var(--danger-text)"; err.textContent = e.message || "Não foi possível registrar. Tente de novo."; $("#feOk", d).disabled = false; }
    });
  }

  /* =========================== QUADRO (viewer) & sem acesso =========================== */
  A.views.quadro = function (el) {
    const P = S.projection || { obras: [], instaladores: [] }, t = C.today();
    const open = (P.obras || []).filter(j => j.status !== "concluida").sort((a, b) => String(a.agenda.inicio || "9999").localeCompare(String(b.agenda.inicio || "9999")));
    el.innerHTML = `<div class="stack loose"><div class="banner tone-info small">${ic("eye", 16)}<span>Quadro somente leitura. Telefones e endereços completos ficam visíveis só para o escritório.</span></div>
      <section class="card"><div class="card-head"><h3 class="h-section">Equipe</h3></div><div class="rows">${(P.instaladores || []).map(i => `<div class="rowitem" style="cursor:default"><span class="avatar">${h(A.initials(i.nome))}</span><span class="grow small strong">${h(i.nome)}</span>${badge("neutral", i.status)}</div>`).join("") || `<div class="card-body small muted">—</div>`}</div></section>
      <section class="card"><div class="card-head"><h3 class="h-section">Obras em aberto (${open.length})</h3></div><div class="table-wrap"><table class="table responsive"><thead><tr><th>Cliente</th><th>Início</th><th>Término previsto</th><th>Equipe</th><th>Bairro</th><th>Situação</th></tr></thead><tbody>${open.map(j => `<tr><td class="cell-title">${h(j.cliente)}</td><td data-label="Início">${j.agenda.inicio ? h(A.relDay(j.agenda.inicio, t)) : "Sem data"}</td><td data-label="Término">${j.fimPrevisto ? C.fmtDate(j.fimPrevisto) : "—"}</td><td data-label="Equipe">${h(j.equipe || "Sem instalador")}</td><td data-label="Bairro">${h(j.bairro || "—")}</td><td data-label="Situação">${badge((C.STATUS[j.status] || C.STATUS.agendada).tone, (C.STATUS[j.status] || C.STATUS.agendada).label, true)}</td></tr>`).join("")}</tbody></table></div></section>
      ${P.atualizado ? `<p class="tiny faint">Atualizado em ${h(C.fmtTs(P.atualizado + ":00.000Z"))}.</p>` : ""}</div>`;
  };
  A.views.semAcesso = function (el) {
    el.innerHTML = `<div class="field-wrap"><div class="card">${A.emptyHTML("info", "Seu acesso à agenda ainda não foi configurado", S.uid ? "Peça ao administrador da Mercatto Decor para cadastrar você em Configurações → Acessos da equipe (como instalador ou visualizador). Depois, recarregue esta página." : "Entre no claude.ai com a conta que recebeu o convite para esta página.")}</div></div>`;
  };

  /* =========================== events =========================== */
  document.addEventListener("click", e => {
    const t = e.target; let x;
    if ((x = t.closest("[data-inst-filter]"))) { ui.inst.status = x.dataset.instFilter; A.render(true); return; }
    if ((x = t.closest("[data-inst-edit]"))) { instEditor(x.dataset.instEdit || null); return; }
    if (t.closest("[data-team-new]")) { teamEditor(null); return; }
    if ((x = t.closest("[data-team-edit]"))) { teamEditor(x.dataset.teamEdit); return; }
    if ((x = t.closest("[data-prange]"))) { ui.perf.range = x.dataset.prange; A.render(true); return; }
    if (t.closest("[data-perf-csv]")) { perfCsv(); return; }
    if (t.closest("[data-migrate]")) { if (S.role === "admin") migrationDialog(); return; }
    if ((x = t.closest("[data-export]"))) { exportData(x.dataset.export); return; }
    if ((x = t.closest("[data-fev]"))) { fieldEventDialog(x.dataset.fev, x.dataset.job); return; }
  });
})();
