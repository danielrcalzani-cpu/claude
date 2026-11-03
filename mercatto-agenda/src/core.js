/*
 * Mercatto Decor — scheduling core.
 *
 * Pure, deterministic business logic shared by the browser app and the Node test suite.
 * No DOM, no storage, no network. Every function takes the data it needs as arguments.
 *
 * Conventions
 *  - Business dates are "YYYY-MM-DD" strings in the America/Manaus calendar.
 *  - Times of day are minutes since midnight (0..1440) or "HH:MM" strings.
 *  - Timestamps (actual start/finish, events) are ISO-8601 UTC strings; convert with tsParts().
 *  - Date arithmetic is done on calendar dates with Date.UTC, never with the browser time zone.
 */
(function (root) {
  "use strict";

  /* ======================================================================
   * 1. Time (America/Manaus, UTC-4, no daylight saving time)
   * ==================================================================== */
  const TZ = "America/Manaus";
  const DTF = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });

  /** Split a Date (or ISO string / epoch ms) into Manaus calendar parts. */
  function tsParts(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d)) return null;
    const p = {};
    for (const part of DTF.formatToParts(d)) p[part.type] = part.value;
    const hour = p.hour === "24" ? "00" : p.hour;
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, min: Number(hour) * 60 + Number(p.minute) };
  }
  /** Current Manaus date/time. `now` can be injected for tests. */
  function nowParts(now) { return tsParts(now || new Date()); }
  function today(now) { return nowParts(now).date; }

  const pad = n => String(n).padStart(2, "0");
  function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function parseYmd(s) { const [y, m, d] = String(s).split("-").map(Number); return { y, m, d }; }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.UTC(...s.split("-").map((v, i) => i === 1 ? v - 1 : +v))); }
  function addDays(s, n) { const { y, m, d } = parseYmd(s); const t = new Date(Date.UTC(y, m - 1, d + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  function dow(s) { const { y, m, d } = parseYmd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function diffDays(a, b) { const A = parseYmd(a), B = parseYmd(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 864e5); }
  function weekStart(s) { const w = dow(s); return addDays(s, w === 0 ? -6 : 1 - w); }
  function toMin(hhmm) { if (typeof hhmm === "number") return hhmm; const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function fromMin(min) { min = Math.max(0, Math.round(min)); return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`; }
  function fmtDate(s) { if (!s) return ""; const { y, m, d } = parseYmd(s); return `${pad(d)}/${pad(m)}/${y}`; }
  function fmtTs(ts) { const p = tsParts(ts); return p ? `${fmtDate(p.date)} às ${p.time}` : ""; }
  const DOW_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const DOW_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MONTH_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  /* ======================================================================
   * 2. Catalogs and defaults
   * ==================================================================== */
  const MATERIALS = [
    { id: "spc", label: "Piso SPC", unit: "m²" },
    { id: "vinilico", label: "Piso vinílico", unit: "m²" },
    { id: "vinilico_reguas", label: "Piso vinílico em réguas", unit: "m²" },
    { id: "vinilico_60", label: "Piso vinílico 60 × 60", unit: "m²" },
    { id: "vinilico_90", label: "Piso vinílico 90 × 90", unit: "m²" },
    { id: "teto_laminado", label: "Teto laminado", unit: "m²" },
    { id: "chateau_mur", label: "Château Mur", unit: "m²" },
    { id: "placa_vinilica", label: "Placa vinílica (Caliza e similares)", unit: "m²" },
    { id: "bambu", label: "Painel flexível de fibra de bambu", unit: "m²" },
    { id: "ripado", label: "Ripado de polietileno", unit: "m²" },
    { id: "painel_laminado", label: "Painel laminado", unit: "m²" },
    { id: "boiserie", label: "Boiserie", unit: "m" },
    { id: "rodape", label: "Rodapé", unit: "m" },
    { id: "acabamentos", label: "Acabamentos e frisos", unit: "m" },
    { id: "outro", label: "Outro material", unit: "un" }
  ];
  const MAT = Object.fromEntries(MATERIALS.map(m => [m.id, m]));
  const UNITS = ["m²", "m", "un", "peças", "placas"];

  /**
   * Reference productivity per installer per working day. These are NOT measured values:
   * they are editable starting points, always labelled "referência" in the UI and replaced by
   * profile values or real history as soon as those exist.
   */
  const REFERENCE_PRODUCTIVITY = {
    spc: 30, vinilico: 30, vinilico_reguas: 25, vinilico_60: 25, vinilico_90: 22,
    teto_laminado: 15, chateau_mur: 15, placa_vinilica: 15, bambu: 12, ripado: 10,
    painel_laminado: 12, boiserie: 8, rodape: 60, acabamentos: 40
  };
  const COMPLEXITY = { baixa: { label: "Simples", factor: 0.85 }, normal: { label: "Normal", factor: 1 }, alta: { label: "Complexa", factor: 1.3 } };

  const STATUS = {
    rascunho: { label: "Rascunho", tone: "neutral" },
    aguardando: { label: "Aguardando confirmação", tone: "accent" },
    agendada: { label: "Agendada", tone: "info" },
    andamento: { label: "Em andamento", tone: "warning" },
    pausada: { label: "Pausada", tone: "pause" },
    concluida: { label: "Concluída", tone: "success" },
    cancelada: { label: "Cancelada", tone: "neutral" }
  };
  /** Statuses whose scheduled blocks reserve installer time. */
  const OCCUPYING = new Set(["aguardando", "agendada", "andamento"]);
  const PRIORITY = { alta: { label: "Urgente", n: 0, tone: "danger" }, media: { label: "Média", n: 1, tone: "warning" }, baixa: { label: "Sem pressa", n: 2, tone: "success" } };

  const READINESS = [
    { id: "material", label: "Material disponível" },
    { id: "cliente", label: "Cliente confirmou" },
    { id: "local", label: "Local liberado" },
    { id: "medidas", label: "Medidas confirmadas" },
    { id: "ferramentas", label: "Ferramentas disponíveis" }
  ];
  const DELAY_CAUSES = { material: "Falta de material", cliente: "Atraso do cliente", acesso: "Problema de acesso ao local", instalador: "Execução / instalador", clima: "Condições do local", outro: "Outro motivo" };

  const DEFAULT_WEEK = {
    1: { on: true, start: "08:00", end: "17:00", breakMin: 60 },
    2: { on: true, start: "08:00", end: "17:00", breakMin: 60 },
    3: { on: true, start: "08:00", end: "17:00", breakMin: 60 },
    4: { on: true, start: "08:00", end: "17:00", breakMin: 60 },
    5: { on: true, start: "08:00", end: "17:00", breakMin: 60 },
    6: { on: true, start: "08:00", end: "12:00", breakMin: 0 },
    0: { on: false, start: "08:00", end: "12:00", breakMin: 0 }
  };

  /** Fixed-date national holidays plus Amazonas/Manaus ones, and Good Friday. Editable in settings. */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }
  function defaultHolidays(years) {
    const out = [];
    for (const y of years) {
      out.push(
        { date: ymd(y, 1, 1), nome: "Confraternização Universal" },
        { date: addDays(easter(y), -2), nome: "Sexta-feira Santa" },
        { date: ymd(y, 4, 21), nome: "Tiradentes" },
        { date: ymd(y, 5, 1), nome: "Dia do Trabalho" },
        { date: ymd(y, 9, 5), nome: "Elevação do Amazonas à categoria de província" },
        { date: ymd(y, 9, 7), nome: "Independência do Brasil" },
        { date: ymd(y, 10, 12), nome: "Nossa Senhora Aparecida" },
        { date: ymd(y, 10, 24), nome: "Aniversário de Manaus" },
        { date: ymd(y, 11, 2), nome: "Finados" },
        { date: ymd(y, 11, 15), nome: "Proclamação da República" },
        { date: ymd(y, 11, 20), nome: "Dia da Consciência Negra" },
        { date: ymd(y, 12, 8), nome: "Nossa Senhora da Conceição (Manaus)" },
        { date: ymd(y, 12, 25), nome: "Natal" }
      );
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function defaultConfig(now) {
    const y = Number(today(now).slice(0, 4));
    return {
      version: 2,
      week: JSON.parse(JSON.stringify(DEFAULT_WEEK)),
      holidays: defaultHolidays([y, y + 1]),
      travelBufferMin: 45,
      setupHours: 1,
      hoursPerDay: 8,
      productivity: { ...REFERENCE_PRODUCTIVITY },
      readinessRequired: { instalacao: ["material", "cliente", "local"], manutencao: ["cliente", "local"] },
      weights: { expertise: 35, availability: 30, proximity: 15, productivity: 10, history: 10 },
      city: "Manaus, AM, Brasil"
    };
  }

  /* ======================================================================
   * 3. Helpers on entities
   * ==================================================================== */
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  function holidaySet(cfg) { return new Set((cfg.holidays || []).map(h => h.date)); }
  function companyDay(cfg, date) {
    if (holidaySet(cfg).has(date)) return null;
    const w = (cfg.week || DEFAULT_WEEK)[dow(date)];
    return w && w.on ? { start: toMin(w.start), end: toMin(w.end), breakMin: w.breakMin || 0 } : null;
  }
  function installerDay(inst, cfg, date) {
    if (holidaySet(cfg).has(date)) return null;
    const week = inst.semana || cfg.week || DEFAULT_WEEK;
    const w = week[dow(date)];
    return w && w.on ? { start: toMin(w.start), end: toMin(w.end), breakMin: w.breakMin || 0 } : null;
  }
  function blockedOn(inst, date) {
    return (inst.bloqueios || []).find(b => b.de <= date && date <= (b.ate || b.de)) || null;
  }
  function capacityMin(day) { return day ? Math.max(0, day.end - day.start - day.breakMin) : 0; }

  /** Resolve the installer ids that execute a job (a team reference is resolved live). */
  function jobMembers(job, teams) {
    if (job.equipeId) {
      const t = (teams || []).find(x => x.id === job.equipeId);
      return t ? [...t.membros] : [];
    }
    return Array.isArray(job.instaladorIds) ? [...job.instaladorIds] : [];
  }
  function jobMaterials(job) { return (job.itens || []).map(i => i.mat).filter(Boolean); }

  /* ======================================================================
   * 4. Duration estimation
   * ==================================================================== */
  /** Real productivity from completed jobs: units per installer per working day, by material. */
  function historicalProductivity(instId, jobs, cfg, memo) {
    if (memo && memo[instId]) return memo[instId];
    const res = historicalProductivityRaw(instId, jobs, cfg);
    if (memo) memo[instId] = res;
    return res;
  }
  function historicalProductivityRaw(instId, jobs, cfg) {
    const acc = {};
    for (const j of jobs) {
      if (j.status !== "concluida" || !j.real || !j.real.inicio || !j.real.fim) continue;
      const members = Array.isArray(j._members) ? j._members : (j.instaladorIds || []);
      if (!members.includes(instId) || (j.itens || []).length !== 1) continue;
      const it = j.itens[0];
      if (!(it.qtd > 0) || it.unidadeInferida) continue;
      const days = workingDaysBetween(tsParts(j.real.inicio).date, tsParts(j.real.fim).date, cfg);
      if (days <= 0) continue;
      const rate = it.qtd / (days * Math.max(1, members.length));
      (acc[it.mat] = acc[it.mat] || []).push(rate);
    }
    const out = {};
    for (const [mat, list] of Object.entries(acc)) if (list.length >= 2) out[mat] = { rate: list.reduce((a, b) => a + b, 0) / list.length, n: list.length };
    return out;
  }
  function workingDaysBetween(a, b, cfg) {
    let n = 0;
    for (let d = a; d <= b; d = addDays(d, 1)) if (companyDay(cfg, d)) n++;
    return n;
  }

  /**
   * Estimate working hours of a job for its crew.
   * Productivity source per installer: history (≥2 jobs) > profile value > reference table.
   * Returns null hours (with a reason) when quantities are missing — never a made-up number.
   */
  function estimateDuration(job, ctx) {
    const cfg = ctx.cfg;
    const members = jobMembers(job, ctx.teams).map(id => ctx.installersById[id]).filter(Boolean);
    const crewSize = Math.max(1, members.length || job.equipeNecessaria || 1);
    const items = (job.itens || []).filter(i => i.mat);
    if (!items.length) return { horas: null, motivo: "Informe o material e a quantidade para calcular a duração." };
    let totalDays = 0;
    const sources = new Set(), parts = [];
    for (const it of items) {
      if (!(Number(it.qtd) > 0)) return { horas: null, motivo: `Informe a quantidade de ${MAT[it.mat] ? MAT[it.mat].label : it.mat}.` };
      let crewRate = 0;
      const perMember = members.length ? members : [null];
      for (const m of perMember) {
        let r = null, src = "referencia";
        if (m) {
          const h = historicalProductivity(m.id, ctx.jobs || [], cfg, ctx._hist)[it.mat];
          if (h) { r = h.rate; src = "historico"; }
          else if (m.produtividade && Number(m.produtividade[it.mat]) > 0) { r = Number(m.produtividade[it.mat]); src = "perfil"; }
        }
        if (r == null) {
          const ref = Number((cfg.productivity || {})[it.mat]);
          if (!(ref > 0)) return { horas: null, motivo: `Sem produtividade cadastrada para ${MAT[it.mat] ? MAT[it.mat].label : it.mat}. Informe a duração manualmente.` };
          r = ref; src = "referencia";
        }
        sources.add(src);
        crewRate += r;
      }
      if (!members.length) crewRate = crewRate * crewSize;
      const factor = (COMPLEXITY[job.complexidade] || COMPLEXITY.normal).factor;
      const days = (it.qtd / crewRate) * factor;
      totalDays += days;
      parts.push(`${fmtNum(it.qtd)} ${it.unidade || (MAT[it.mat] || {}).unit || ""} de ${(MAT[it.mat] || {}).label || it.mat} ÷ ${fmtNum(crewRate)}/dia${factor !== 1 ? ` × ${factor}` : ""}`);
    }
    const hours = Math.round((totalDays * (cfg.hoursPerDay || 8) + (cfg.setupHours || 0)) * 2) / 2;
    const origem = sources.has("referencia") ? (sources.size > 1 ? "misto" : "referencia") : (sources.has("historico") ? "historico" : "perfil");
    return {
      horas: hours,
      dias: Math.round((hours / (cfg.hoursPerDay || 8)) * 10) / 10,
      origem,
      detalhe: parts.join(" + ") + ` + ${cfg.setupHours || 0} h de preparação e acabamento`,
      confianca: origem === "historico" ? "alta" : origem === "perfil" ? "média" : "baixa"
    };
  }
  const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString("pt-BR");

  /** Working hours actually planned for a job (manual override wins over the estimate). */
  function plannedHours(job, ctx) {
    if (job.agenda && Number(job.agenda.horas) > 0) return Number(job.agenda.horas);
    const e = estimateDuration(job, ctx);
    return e.horas || null;
  }

  /* ======================================================================
   * 5. Allocation: turn (start date, start time, hours) into daily blocks
   * ==================================================================== */
  /**
   * Allocate a job on the company calendar. Personal calendars (days off, vacations, hours)
   * are checked by the validator, so a conflict is reported instead of silently shifting work.
   * Blocks are wall-clock intervals; a lunch break is added when a block spans more than 4 h.
   */
  function allocate(job, ctx) {
    if (ctx._alloc && ctx._alloc.has(job)) return ctx._alloc.get(job);
    const r = allocateRaw(job, ctx);
    if (ctx._alloc) ctx._alloc.set(job, r);
    return r;
  }
  function allocateRaw(job, ctx) {
    const a = job.agenda || {};
    if (!isDate(a.inicio)) return { blocks: [], fim: null, motivo: "sem_data" };
    const hours = plannedHours(job, ctx);
    if (!(hours > 0)) return { blocks: [], fim: null, motivo: "sem_duracao" };
    let remaining = hours * 60;
    const blocks = [];
    let date = a.inicio, first = true, guard = 0;
    while (remaining > 0 && guard++ < 400) {
      const day = companyDay(ctx.cfg, date);
      if (day) {
        let start = day.start;
        if (first && toMin(a.hora) != null) start = Math.max(day.start, toMin(a.hora));
        const room = day.end - start;
        const breakApplies = d => (d > 240 ? day.breakMin : 0);
        let work = Math.min(remaining, Math.max(0, room - breakApplies(room)));
        if (work <= 0 && first && toMin(a.hora) != null) work = Math.min(remaining, Math.max(0, room)); // late start, no break
        if (work > 0) {
          const end = Math.min(day.end, start + work + breakApplies(work));
          blocks.push({ date, start, end, work });
          remaining -= work;
        }
        first = false;
      } else if (first && date === a.inicio) {
        first = false;
      }
      if (remaining > 0) date = addDays(date, 1);
    }
    const last = blocks[blocks.length - 1];
    return { blocks, fim: last ? last.date : null, fimHora: last ? fromMin(last.end) : null, horas: hours };
  }

  /* ======================================================================
   * 6. Occupancy index and centralized validation
   * ==================================================================== */
  /** Build context lookups once per data version. */
  function buildContext(data, now) {
    const installersById = Object.fromEntries((data.installers || []).map(i => [i.id, i]));
    const ctx = { ...data, installersById, now: now || new Date(), today: today(now), _alloc: new WeakMap(), _hist: {} };
    ctx.jobs = (data.jobs || []).map(j => ({ ...j, _members: jobMembers(j, data.teams) }));
    ctx.jobsById = Object.fromEntries(ctx.jobs.map(j => [j.id, j]));
    ctx.occ = buildOccupancy(ctx);
    return ctx;
  }

  /** installerId -> date -> [{start,end,jobId}] for every occupying job. */
  function buildOccupancy(ctx, exceptJobId) {
    const occ = {};
    for (const j of ctx.jobs) {
      if (j.id === exceptJobId || !OCCUPYING.has(j.status)) continue;
      const blocks = occupyingBlocks(j, ctx);
      for (const m of j._members || jobMembers(j, ctx.teams)) {
        const byDate = (occ[m] = occ[m] || {});
        for (const b of blocks) (byDate[b.date] = byDate[b.date] || []).push({ start: b.start, end: b.end, jobId: j.id });
      }
    }
    return occ;
  }
  /** A job in progress past its planned end keeps occupying its crew until today. */
  function occupyingBlocks(job, ctx) {
    const al = allocate(job, ctx);
    const blocks = [...al.blocks];
    // In progress with no usable duration (e.g. migrated without quantity): still occupies the crew today.
    if (job.status === "andamento" && !blocks.length && job.agenda && job.agenda.inicio && job.agenda.inicio <= ctx.today) {
      const day = companyDay(ctx.cfg, ctx.today);
      if (day) blocks.push({ date: ctx.today, start: day.start, end: day.end, work: capacityMin(day), extra: true });
      return blocks;
    }
    if (job.status === "andamento" && al.fim && al.fim < ctx.today) {
      for (let d = addDays(al.fim, 1); d <= ctx.today; d = addDays(d, 1)) {
        const day = companyDay(ctx.cfg, d);
        if (day) blocks.push({ date: d, start: day.start, end: day.end, work: capacityMin(day), extra: true });
      }
    }
    return blocks;
  }

  function sameSite(a, b) {
    if (a.endereco && b.endereco && a.endereco.lat != null && b.endereco.lat != null) return haversineKm(a.endereco, b.endereco) < 0.3;
    const la = norm((a.endereco && (a.endereco.completo || a.endereco.bairro)) || ""), lb = norm((b.endereco && (b.endereco.completo || b.endereco.bairro)) || "");
    return !!la && la === lb;
  }

  /**
   * THE single scheduling validator. Every screen (form, calendar drag, availability edits,
   * maintenance visits) calls this. Returns issues with severity "erro" (blocks automatic
   * confirmation; manual override needs a reason) or "aviso" (informational).
   */
  function validateJob(job, ctx) {
    const issues = [];
    const push = (code, severity, msg, extra) => issues.push({ code, severity, msg, ...(extra || {}) });
    const members = jobMembers(job, ctx.teams);
    const statusOccupies = OCCUPYING.has(job.status) || job.status === "rascunho";
    const al = allocate(job, ctx);
    if (job.status === "concluida" || job.status === "cancelada") return issues;

    if (!members.length) {
      if (al.blocks.length && job.status !== "rascunho") push("SEM_INSTALADOR", "aviso", "Obra agendada sem instalador.");
    }
    if (job.equipeNecessaria > 1 && members.length && members.length < job.equipeNecessaria)
      push("EQUIPE_INSUFICIENTE", "erro", `A obra precisa de ${job.equipeNecessaria} instaladores e só ${members.length} foram definidos.`);
    if (!al.blocks.length) {
      if (al.motivo === "sem_duracao" && job.agenda && job.agenda.inicio) push("SEM_DURACAO", "aviso", "Defina a duração (ou material e quantidade) para reservar a agenda.");
      return issues;
    }
    if (!statusOccupies) return issues;

    const mats = jobMaterials(job);
    const occ = ctx.occ || buildOccupancy(ctx);
    const buffer = ctx.cfg.travelBufferMin || 0;
    for (const id of members) {
      const inst = ctx.installersById[id];
      if (!inst) { push("INSTALADOR_REMOVIDO", "erro", "Um instalador desta obra não existe mais no cadastro.", { instId: id }); continue; }
      const nome = inst.nome;
      if (inst.ativo === false) push("INATIVO", "erro", `${nome} está inativo.`, { instId: id });
      for (const m of mats) {
        if (!inst.materiais || !(inst.materiais[m] > 0)) push("SEM_ESPECIALIDADE", "aviso", `${nome} não tem ${(MAT[m] || {}).label || m} entre os materiais que instala.`, { instId: id });
      }
      if (job.tipo === "manutencao" && inst.fazManutencao === false) push("SEM_MANUTENCAO", "aviso", `${nome} não está habilitado para manutenções.`, { instId: id });
      for (const b of al.blocks) {
        const blk = blockedOn(inst, b.date);
        if (blk) { push("INDISPONIVEL", "erro", `${nome} está indisponível em ${fmtDate(b.date)} (${blk.motivo || blk.tipo || "bloqueio"}).`, { instId: id, date: b.date }); continue; }
        const day = installerDay(inst, ctx.cfg, b.date);
        if (!day) { push("DIA_DE_FOLGA", "erro", `${fmtDate(b.date)} não é dia de trabalho de ${nome}.`, { instId: id, date: b.date }); continue; }
        if (b.start < day.start || b.end > day.end) push("FORA_DO_HORARIO", "erro", `Em ${fmtDate(b.date)} o trabalho (${fromMin(b.start)}–${fromMin(b.end)}) passa do horário de ${nome} (${fromMin(day.start)}–${fromMin(day.end)}).`, { instId: id, date: b.date });
        for (const o of ((occ[id] || {})[b.date] || [])) {
          if (o.jobId === job.id) continue;
          const other = ctx.jobsById[o.jobId];
          if (b.start < o.end && o.start < b.end) {
            push("SOBREPOSICAO", "erro", `${nome} já está em "${other ? other.cliente : "outra obra"}" em ${fmtDate(b.date)} (${fromMin(o.start)}–${fromMin(o.end)}).`, { instId: id, date: b.date, otherJobId: o.jobId });
          } else if (buffer && other && !sameSite(job, other)) {
            const gap = b.start >= o.end ? b.start - o.end : o.start - b.end;
            if (gap < buffer) push("DESLOCAMENTO", "aviso", `Intervalo de ${gap} min entre "${other.cliente}" e esta obra em ${fmtDate(b.date)} para ${nome} — menos que os ${buffer} min reservados para deslocamento.`, { instId: id, date: b.date, otherJobId: o.jobId });
          }
        }
      }
    }
    const rd = readiness(job, ctx);
    if (rd.state === "bloqueada") push("NAO_PRONTA", "aviso", `Obra começa ${al.blocks[0].date <= ctx.today ? "hoje" : "amanhã"} sem: ${rd.missing.join(", ")}.`);
    return dedupeIssues(issues);
  }
  function dedupeIssues(list) {
    const seen = new Set();
    return list.filter(i => { const k = i.code + "|" + (i.instId || "") + "|" + (i.otherJobId || "") + "|" + (i.code === "SOBREPOSICAO" || i.code === "SEM_ESPECIALIDADE" ? "" : (i.date || "")) + (i.code === "SEM_ESPECIALIDADE" ? i.msg : ""); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const hasErrors = issues => issues.some(i => i.severity === "erro");

  /** Re-validate every active job (used after availability or team changes). */
  function validateAll(ctx) {
    const out = {};
    for (const j of ctx.jobs) {
      if (!OCCUPYING.has(j.status) && j.status !== "rascunho" && j.status !== "pausada") continue;
      const v = validateJob(j, ctx);
      if (v.length) out[j.id] = v;
    }
    return out;
  }

  /* ======================================================================
   * 7. Readiness and derived flags
   * ==================================================================== */
  function readiness(job, ctx) {
    const req = ((ctx.cfg.readinessRequired || {})[job.tipo || "instalacao"]) || [];
    const p = job.prontidao || {};
    const missing = READINESS.filter(r => req.includes(r.id) && !p[r.id]).map(r => r.label);
    const optionalMissing = READINESS.filter(r => !req.includes(r.id) && !p[r.id]).map(r => r.label);
    if (job.status === "concluida" || job.status === "cancelada") return { state: "na", missing: [], optionalMissing: [] };
    if (!missing.length) return { state: "pronta", missing, optionalMissing };
    const start = job.agenda && job.agenda.inicio;
    const soon = start && start <= addDays(ctx.today, 1);
    return { state: soon || job.status === "andamento" ? "bloqueada" : "pendente", missing, optionalMissing };
  }

  /** Computed alerts on a job; never stored as statuses. */
  function jobFlags(job, ctx) {
    const al = allocate(job, ctx);
    const t = ctx.today;
    const f = { semData: !(job.agenda && job.agenda.inicio), fimPrevisto: al.fim, blocks: al.blocks };
    f.semInstalador = !jobMembers(job, ctx.teams).length && !["concluida", "cancelada"].includes(job.status);
    f.atrasada = (job.status === "agendada" || job.status === "aguardando") && !!job.agenda && !!job.agenda.inicio && job.agenda.inicio < t;
    f.excedeu = job.status === "andamento" && !!al.fim && al.fim < t;
    f.iniciaHoje = !!job.agenda && job.agenda.inicio === t && ["agendada", "aguardando"].includes(job.status);
    f.terminaHoje = al.fim === t && ["andamento", "agendada"].includes(job.status);
    return f;
  }

  /* ======================================================================
   * 8. Installer status (scheduled vs. actually confirmed)
   * ==================================================================== */
  /**
   * events: field events of this installer, each {tipo, jobId, at, origem}. Only events
   * the installer sent from their own device count as confirmation ("campo").
   */
  function installerStatus(inst, ctx, events) {
    const t = ctx.today;
    if (inst.ativo === false) return { code: "inativo", label: "Inativo", tone: "neutral" };
    const evs = (events || []).filter(e => e.instId === inst.id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = evs[evs.length - 1];
    const blk = blockedOn(inst, t);
    const blocksToday = ((ctx.occ[inst.id] || {})[t] || []).slice().sort((a, b) => a.start - b.start);
    const base = { lastEvent: last || null, confirmed: false, jobId: blocksToday[0] ? blocksToday[0].jobId : null };
    if (last) {
      const lp = tsParts(last.at);
      const open = last.tipo === "inicio" || last.tipo === "retomada" || last.tipo === "a_caminho" || last.tipo === "pausa";
      if (open && (lp.date === t || last.tipo !== "a_caminho")) {
        const job = ctx.jobsById[last.jobId];
        if (job && job.status !== "concluida" && job.status !== "cancelada") {
          if (last.tipo === "a_caminho") return { ...base, code: "deslocamento", label: "Em deslocamento", tone: "info", confirmed: true, jobId: last.jobId, since: last.at };
          if (last.tipo === "pausa") return { ...base, code: "pausado", label: "Pausado", tone: "pause", confirmed: true, jobId: last.jobId, since: last.at };
          return { ...base, code: "em_obra", label: "Em obra", tone: "warning", confirmed: true, jobId: last.jobId, since: last.at };
        }
      }
    }
    if (blk) return { ...base, code: "indisponivel", label: "Indisponível", tone: "neutral", motivo: blk.motivo || blk.tipo };
    const running = ctx.jobs.find(j => j.status === "andamento" && (j._members || []).includes(inst.id));
    if (running) return { ...base, code: "em_obra_escritorio", label: "Em obra (sem check-in)", tone: "warning", jobId: running.id };
    if (!installerDay(inst, ctx.cfg, t)) return { ...base, code: "indisponivel", label: "Folga hoje", tone: "neutral" };
    if (blocksToday.length) return { ...base, code: "agendado", label: "Agendado", tone: "info" };
    return { ...base, code: "disponivel", label: "Disponível", tone: "success" };
  }

  /* ======================================================================
   * 9. Workload
   * ==================================================================== */
  function workload(inst, ctx, fromDate, days) {
    fromDate = fromDate || weekStart(ctx.today); days = days || 7;
    let cap = 0, used = 0;
    for (let i = 0; i < days; i++) {
      const d = addDays(fromDate, i);
      if (blockedOn(inst, d)) continue;
      const day = installerDay(inst, ctx.cfg, d);
      cap += capacityMin(day);
      for (const b of ((ctx.occ[inst.id] || {})[d] || [])) used += Math.max(0, b.end - b.start - (b.end - b.start > 240 && day ? day.breakMin : 0));
    }
    const pct = cap ? Math.round((used / cap) * 100) : (used ? 999 : 0);
    const level = pct > 100 ? "sobrecarregado" : pct >= 85 ? "cheio" : pct < 40 ? "ocioso" : "equilibrado";
    return { capacidadeH: cap / 60, ocupadoH: Math.round(used / 6) / 10, pct, level, proximaVaga: nextFreeDay(inst, ctx, ctx.today) };
  }
  function nextFreeDay(inst, ctx, from) {
    for (let i = 0; i < 90; i++) {
      const d = addDays(from, i);
      if (blockedOn(inst, d)) continue;
      const day = installerDay(inst, ctx.cfg, d);
      if (!day) continue;
      const used = ((ctx.occ[inst.id] || {})[d] || []).reduce((s, b) => s + (b.end - b.start), 0);
      if (capacityMin(day) - used >= 180) return d;
    }
    return null;
  }

  /* ======================================================================
   * 10. Geography (only real coordinates; never derived from neighbourhood names)
   * ==================================================================== */
  function haversineKm(a, b) {
    const R = 6371, toR = x => (x * Math.PI) / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /** Accepts "lat, lng" or a Google Maps link containing @lat,lng / q=lat,lng / !3dlat!4dlng. */
  function parseCoords(text) {
    const s = String(text || "").trim();
    const pats = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/];
    for (const p of pats) {
      const m = p.exec(s);
      if (m) {
        const lat = Number(m[1].replace(",", ".")), lng = Number(m[2].replace(",", "."));
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, dentroDeManaus: lat > -3.25 && lat < -2.85 && lng > -60.25 && lng < -59.8 };
      }
    }
    return null;
  }
  const hasCoords = e => !!e && typeof e.lat === "number" && typeof e.lng === "number";

  /** Where the installer is expected to come from on `date`: previous job that day/before, else home base. */
  function referencePoint(inst, ctx, date, exceptJobId) {
    const days = [date, addDays(date, -1)];
    for (const d of days) {
      const list = ((ctx.occ[inst.id] || {})[d] || []).filter(b => b.jobId !== exceptJobId).sort((a, b) => b.end - a.end);
      for (const b of list) {
        const j = ctx.jobsById[b.jobId];
        if (j && j.endereco && (hasCoords(j.endereco) || j.endereco.bairro)) return { job: j, endereco: j.endereco, fonte: d === date ? "obra do mesmo dia" : "obra do dia anterior" };
      }
    }
    if (inst.base && hasCoords(inst.base)) return { endereco: inst.base, fonte: "base do instalador" };
    return null;
  }

  /* ======================================================================
   * 11. Recommendation engine (deterministic, explainable)
   * ==================================================================== */
  function candidateUnits(job, ctx) {
    const n = Math.max(1, job.equipeNecessaria || 1);
    const units = [];
    if (n === 1) for (const i of ctx.installers || []) units.push({ kind: "instalador", id: i.id, nome: i.nome, members: [i.id] });
    for (const t of ctx.teams || []) if ((t.membros || []).length >= n) units.push({ kind: "equipe", id: t.id, nome: t.nome, members: [...t.membros] });
    return units;
  }

  /** Try `job` with the given crew on `date`; returns validation issues (errors only matter). */
  function trial(job, members, date, ctx) {
    const probe = { ...job, status: job.status === "rascunho" || !job.status ? "agendada" : job.status, equipeId: null, instaladorIds: members, agenda: { ...(job.agenda || {}), inicio: date } };
    // Without a duration, availability is checked for one full working day (stated in the UI).
    if (!plannedHours(probe, ctx)) probe.agenda.horas = ctx.cfg.hoursPerDay || 8;
    return validateJob(probe, ctx).filter(i => i.severity === "erro" && i.code !== "EQUIPE_INSUFICIENTE");
  }
  function nextAvailableDate(job, members, ctx, from, horizon) {
    from = from && from > ctx.today ? from : ctx.today;
    for (let i = 0; i < (horizon || 60); i++) {
      const d = addDays(from, i);
      if (!companyDay(ctx.cfg, d)) continue;
      if (!trial(job, members, d, ctx).length) return d;
    }
    return null;
  }

  function historyScore(instIds, ctx) {
    const done = ctx.jobs.filter(j => j.status === "concluida" && j.real && j.real.fim && (j._members || []).some(m => instIds.includes(m)));
    if (done.length < 3) return null;
    let onTime = 0, rework = 0, counted = 0;
    for (const j of done) {
      const planned = allocate(j, ctx).fim;
      const actual = tsParts(j.real.fim).date;
      const cause = j.atrasoCausa;
      if (!planned) continue;
      counted++;
      if (actual <= planned || (cause && cause !== "instalador")) onTime++;
      if (ctx.jobs.some(m => m.manutencaoDe === j.id && m.retrabalho)) rework++;
    }
    if (counted < 3) return null;
    return { score: (onTime / counted) * 0.8 + (1 - rework / counted) * 0.2, onTime, counted, rework };
  }

  /**
   * Rank installers/teams for a job. Mandatory filters first (active, material, maintenance
   * capability, full availability, no conflicts, staffing); soft weighted score afterwards.
   * Unknown factors are dropped and their weight redistributed; confidence is reported.
   */
  function recommend(job, ctx, limit) {
    const W = ctx.cfg.weights || defaultConfig().weights;
    const mats = jobMaterials(job);
    const desired = job.agenda && isDate(job.agenda.inicio) ? job.agenda.inicio : null;
    const ranked = [], rejected = [];
    const units = candidateUnits(job, ctx);

    // productivity of each unit on the job's materials (profile/history only; reference values do not differentiate)
    const prodOf = members => {
      if (!mats.length) return null;
      let tot = 0;
      for (const m of mats) {
        let unitRate = 0;
        for (const id of members) {
          const inst = ctx.installersById[id];
          const h = historicalProductivity(id, ctx.jobs, ctx.cfg, ctx._hist)[m];
          const r = h ? h.rate : inst && inst.produtividade && Number(inst.produtividade[m]) > 0 ? Number(inst.produtividade[m]) : null;
          if (r == null) return null;
          unitRate += r;
        }
        tot += unitRate;
      }
      return tot / mats.length;
    };
    const prods = {};
    for (const u of units) prods[u.kind + u.id] = prodOf(u.members);
    const bestProd = Math.max(0, ...Object.values(prods).filter(v => v != null));

    for (const u of units) {
      const insts = u.members.map(id => ctx.installersById[id]);
      const reasons = [], rej = [];
      if (insts.some(i => !i)) { rejected.push({ ...u, motivos: ["Membro removido do cadastro"] }); continue; }
      if (insts.some(i => i.ativo === false)) rej.push("Inativo");
      if (job.tipo === "manutencao" && insts.some(i => i.fazManutencao === false)) rej.push("Não faz manutenção");
      for (const m of mats) if (insts.some(i => !(i.materiais && i.materiais[m] > 0))) rej.push(`Não instala ${(MAT[m] || {}).label || m}`);
      const fromDate = desired || ctx.today;
      const next = rej.length ? null : nextAvailableDate(job, u.members, ctx, fromDate, 60);
      if (!rej.length) {
        if (desired) {
          const errs = trial(job, u.members, desired, ctx);
          if (errs.length) rej.push(errs[0].msg);
        } else if (!next) rej.push("Sem vaga nos próximos 60 dias");
      }
      if (rej.length) { rejected.push({ ...u, motivos: [...new Set(rej)], proximaData: rej.length && !rej.some(r => r.startsWith("Não") || r === "Inativo") ? nextAvailableDate(job, u.members, ctx, fromDate, 60) : null }); continue; }

      const date = desired || next;
      const f = {};
      // expertise (1..5 ratings)
      if (mats.length) {
        const vals = mats.map(m => insts.reduce((s, i) => s + (i.materiais[m] || 0), 0) / insts.length);
        f.expertise = vals.reduce((a, b) => a + b, 0) / vals.length / 5;
        const top = Math.min(...vals);
        reasons.push(top >= 4 ? `Especialista em ${mats.map(m => (MAT[m] || {}).label).join(", ")}` : `Experiência ${top >= 3 ? "boa" : "básica"} com ${mats.map(m => (MAT[m] || {}).label).join(", ")}`);
      }
      // availability (+ workload balancing as a small component)
      const util = insts.map(i => workload(i, ctx, weekStart(date), 7).pct).reduce((a, b) => a + b, 0) / insts.length;
      const delay = desired ? 0 : Math.max(0, diffDays(ctx.today, date));
      f.availability = Math.max(0, 1 - Math.min(delay, 14) / 14 * 0.7) * 0.85 + 0.15 * Math.max(0, 1 - Math.min(util, 100) / 100);
      reasons.push(desired ? "Disponível durante todo o período" : `Disponível a partir de ${fmtDate(date)}`);
      if (util < 40) reasons.push(`Agenda com folga nesta semana (${util}% ocupada)`);
      // proximity — only with real coordinates, or an explicitly identical neighbourhood text
      const jobE = job.endereco || {};
      const refs = insts.map(i => referencePoint(i, ctx, date, job.id)).filter(Boolean);
      if (refs.length && hasCoords(jobE) && refs.some(r => hasCoords(r.endereco))) {
        const r = refs.find(r => hasCoords(r.endereco));
        const km = haversineKm(jobE, r.endereco);
        f.proximity = Math.max(0, 1 - km / 20);
        f._km = km;
        reasons.push(`${fmtNum(km)} km em linha reta da ${r.fonte}${r.job ? ` (${r.job.cliente})` : ""}`);
      } else if (refs.length && jobE.bairro && refs.some(r => r.endereco && norm(r.endereco.bairro) === norm(jobE.bairro))) {
        const r = refs.find(r => r.endereco && norm(r.endereco.bairro) === norm(jobE.bairro));
        f.proximity = 0.9;
        reasons.push(`Já tem obra no mesmo bairro (${jobE.bairro}) — ${r.fonte}`);
      }
      // productivity
      const p = prods[u.kind + u.id];
      if (p != null && bestProd > 0) { f.productivity = p / bestProd; if (p >= bestProd * 0.95) reasons.push("Melhor produtividade registrada nesse material"); }
      // history
      const hs = historyScore(u.members, ctx);
      if (hs) { f.history = hs.score; reasons.push(`${hs.onTime} de ${hs.counted} obras concluídas no prazo`); }

      let wsum = 0, ssum = 0;
      for (const k of ["expertise", "availability", "proximity", "productivity", "history"]) if (f[k] != null) { wsum += W[k]; ssum += W[k] * f[k]; }
      const known = ["expertise", "availability", "proximity", "productivity", "history"].filter(k => f[k] != null);
      const score = wsum ? Math.round((ssum / wsum) * 100) : 0;
      const est = estimateDuration({ ...job, equipeId: null, instaladorIds: u.members }, ctx);
      ranked.push({
        ...u, score, data: date, proximaData: next, factors: f, reasons,
        confianca: known.length === 5 ? "alta" : known.length >= 3 ? "média" : "baixa",
        fatoresAusentes: ["proximity", "productivity", "history"].filter(k => f[k] == null),
        estimativa: est, km: f._km != null ? f._km : null, util
      });
    }
    ranked.sort((a, b) => b.score - a.score || String(a.data).localeCompare(String(b.data)) || a.nome.localeCompare(b.nome, "pt-BR") || a.id.localeCompare(b.id));
    return { candidatos: ranked.slice(0, limit || 3), todos: ranked, rejeitados: rejected.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), pesos: W };
  }

  /* ======================================================================
   * 12. Alerts and optimisation suggestions
   * ==================================================================== */
  function buildAlerts(ctx, events) {
    const out = [];
    const t = ctx.today, tomorrow = addDays(t, 1);
    const add = (key, severity, tipo, msg, extra) => out.push({ key, severity, tipo, msg, ...(extra || {}) });
    const seenPairs = new Set();
    for (const j of ctx.jobs) {
      if (["concluida", "cancelada"].includes(j.status)) continue;
      const f = jobFlags(j, ctx);
      const issues = validateJob(j, ctx);
      for (const i of issues) {
        if (i.code === "SOBREPOSICAO") {
          const pair = [j.id, i.otherJobId].sort().join("+") + i.instId;
          if (seenPairs.has(pair)) continue;
          seenPairs.add(pair);
          add(`dup:${pair}`, "alta", "Instalador com duas obras", i.msg, { jobId: j.id, instId: i.instId, acao: "resolver" });
        } else if (["INDISPONIVEL", "DIA_DE_FOLGA", "FORA_DO_HORARIO", "INATIVO", "EQUIPE_INSUFICIENTE", "INSTALADOR_REMOVIDO"].includes(i.code)) {
          add(`disp:${j.id}:${i.code}:${i.instId || ""}`, "alta", "Fora da disponibilidade", `${j.cliente}: ${i.msg}`, { jobId: j.id, instId: i.instId, acao: "resolver" });
        } else if (i.code === "DESLOCAMENTO") {
          add(`desl:${j.id}:${i.otherJobId}`, "media", "Pouco tempo de deslocamento", i.msg, { jobId: j.id, acao: "abrir" });
        }
      }
      const rd = readiness(j, ctx);
      const start = j.agenda && j.agenda.inicio;
      if (f.semInstalador && start && start <= addDays(t, 14) && j.status !== "rascunho") add(`semInst:${j.id}`, start <= tomorrow ? "alta" : "media", "Obra sem instalador", `${j.cliente} começa ${relDay(start, t)} e não tem instalador.`, { jobId: j.id, acao: "atribuir" });
      if (start === tomorrow && !(j.prontidao || {}).cliente) add(`conf:${j.id}`, "alta", "Amanhã sem confirmação do cliente", `${j.cliente} está marcada para amanhã e o cliente ainda não confirmou.`, { jobId: j.id, acao: "whatsapp_confirmar" });
      if (start && start <= tomorrow && j.status !== "andamento" && !(j.prontidao || {}).material) add(`mat:${j.id}`, "alta", "Material não está pronto", `${j.cliente} começa ${relDay(start, t)} e o material não foi marcado como disponível.`, { jobId: j.id, acao: "prontidao" });
      else if (rd.state === "bloqueada" && j.status !== "andamento") add(`pront:${j.id}`, "media", "Obra não está pronta", `${j.cliente}: falta ${rd.missing.join(", ")}.`, { jobId: j.id, acao: "prontidao" });
      if (f.atrasada) add(`atr:${j.id}`, "alta", "Obra atrasada", `${j.cliente} deveria ter começado em ${fmtDate(start)} e ainda não foi iniciada.`, { jobId: j.id, acao: "reagendar" });
      if (f.excedeu) add(`exc:${j.id}`, "media", "Passou da duração estimada", `${j.cliente} tinha término previsto em ${fmtDate(f.fimPrevisto)} e segue em andamento.`, { jobId: j.id, acao: "abrir" });
      if (j.prio === "alta" && !start && j.status !== "rascunho") add(`urg:${j.id}`, "alta", "Urgente sem data", `${j.cliente} é urgente e ainda não tem data.`, { jobId: j.id, acao: "atribuir" });
      if (j.status === "aguardando") add(`agu:${j.id}`, "baixa", "Aguardando confirmação", `${j.cliente} aguarda confirmação${start ? ` para ${fmtDate(start)}` : ""}.`, { jobId: j.id, acao: "whatsapp_confirmar" });
    }
    for (const j of ctx.jobs) {
      if (j.status === "concluida" && j.conclusao && j.conclusao.pendencias && !ctx.jobs.some(m => m.manutencaoDe === j.id))
        add(`pend:${j.id}`, "media", "Pendência sem manutenção", `${j.cliente} foi concluída com pendências: ${j.conclusao.pendencias}`, { jobId: j.id, acao: "criar_manutencao" });
    }
    for (const i of ctx.installers || []) {
      const b = blockedOn(i, t);
      if (b && i.ativo !== false) {
        const affected = ((ctx.occ[i.id] || {})[t] || []).length;
        if (affected) add(`aus:${i.id}:${t}`, "alta", "Instalador ausente com obra", `${i.nome} está indisponível hoje (${b.motivo || b.tipo}) e tem obra marcada.`, { instId: i.id, acao: "realocar" });
      }
    }
    for (const p of events && events.problemas ? events.problemas : []) {
      add(`prob:${p.id}`, "alta", "Problema informado pelo instalador", `${p.cliente}: ${p.nota}`, { jobId: p.jobId, acao: "abrir" });
    }
    const rank = { alta: 0, media: 1, baixa: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
  }
  function relDay(d, t) { if (d === t) return "hoje"; if (d === addDays(t, 1)) return "amanhã"; if (d === addDays(t, -1)) return "ontem"; return `em ${fmtDate(d)}`; }

  function buildSuggestions(ctx) {
    const out = [];
    const t = ctx.today;
    const open = ctx.jobs.filter(j => !["concluida", "cancelada", "rascunho"].includes(j.status));
    // 1) urgent / unassigned jobs with a qualified free installer
    for (const j of open.filter(j => !(j._members || []).length || !(j.agenda && j.agenda.inicio)).sort((a, b) => (PRIORITY[a.prio] || { n: 3 }).n - (PRIORITY[b.prio] || { n: 3 }).n).slice(0, 6)) {
      if (!jobMaterials(j).length) continue;
      const r = recommend(j, ctx, 1).candidatos[0];
      if (r) out.push({ key: `atrib:${j.id}:${r.id}:${r.data}`, tipo: "atribuir", texto: `${r.nome} está disponível ${relDay(r.data, t)} e tem experiência com ${jobMaterials(j).map(m => (MAT[m] || {}).label).join(", ")} — sugestão para ${j.cliente}.`, jobId: j.id, unit: { kind: r.kind, id: r.id, members: r.members }, data: r.data });
    }
    // 2) jobs that can be anticipated with the same crew
    for (const j of open.filter(j => j.status === "agendada" && j.agenda && j.agenda.inicio > addDays(t, 1) && (j._members || []).length)) {
      if (readiness(j, ctx).missing.length) continue;
      const d = nextAvailableDate(j, j._members, ctx, addDays(t, 1), 30);
      if (d && d < j.agenda.inicio) {
        const gain = workingDaysBetween(d, addDays(j.agenda.inicio, -1), ctx.cfg);
        if (gain >= 1) out.push({ key: `antec:${j.id}:${d}`, tipo: "antecipar", texto: `${j.cliente} pode ser antecipada em ${gain} dia${gain > 1 ? "s" : ""} úteis (para ${fmtDate(d)}) com a mesma equipe.`, jobId: j.id, data: d });
      }
    }
    // 3) nearby jobs that could be sequenced for the same installer
    const located = open.filter(j => j.endereco && (hasCoords(j.endereco) || j.endereco.bairro));
    for (let a = 0; a < located.length; a++) for (let b = a + 1; b < located.length; b++) {
      const A = located[a], B = located[b];
      const near = hasCoords(A.endereco) && hasCoords(B.endereco) ? haversineKm(A.endereco, B.endereco) <= 3 : (!!A.endereco.bairro && norm(A.endereco.bairro) === norm(B.endereco.bairro));
      if (!near) continue;
      const shared = (A._members || []).filter(m => (B._members || []).includes(m));
      const datesDiffer = A.agenda && B.agenda && A.agenda.inicio && B.agenda.inicio && Math.abs(diffDays(A.agenda.inicio, B.agenda.inicio)) > 3;
      if ((A._members || []).length && !(B._members || []).length || (!(A._members || []).length && (B._members || []).length)) {
        const withCrew = (A._members || []).length ? A : B, without = withCrew === A ? B : A;
        const names = withCrew._members.map(id => (ctx.installersById[id] || {}).nome).filter(Boolean).join(" e ");
        out.push({ key: `prox:${withCrew.id}:${without.id}`, tipo: "proximas", texto: `${without.cliente} fica ${hasCoords(A.endereco) && hasCoords(B.endereco) ? "a menos de 3 km (linha reta)" : `no mesmo bairro (${without.endereco.bairro})`} de ${withCrew.cliente}, de ${names} — avalie programar em sequência.`, jobId: without.id });
      } else if (shared.length && datesDiffer) {
        out.push({ key: `seq:${A.id}:${B.id}`, tipo: "proximas", texto: `${A.cliente} e ${B.cliente} são próximas e têm o mesmo instalador em datas distantes — podem ser programadas em dias consecutivos.`, jobId: B.id });
      }
    }
    // 4) conflicts with an alternative crew
    const conflicts = validateAll(ctx);
    for (const [jobId, issues] of Object.entries(conflicts)) {
      const ov = issues.find(i => i.code === "SOBREPOSICAO" || i.code === "INDISPONIVEL" || i.code === "DIA_DE_FOLGA");
      if (!ov) continue;
      const j = ctx.jobsById[jobId];
      const alt = recommend(j, ctx, 1).candidatos[0];
      out.push({ key: `conf:${jobId}:${alt ? alt.id : "-"}`, tipo: "conflito", texto: `Conflito ${ov.date ? `em ${DOW_PT[dow(ov.date)]} (${fmtDate(ov.date)})` : ""}: ${ov.msg}${alt ? ` Alternativa: ${alt.nome}${alt.data !== (j.agenda || {}).inicio ? ` a partir de ${fmtDate(alt.data)}` : ""}.` : ""}`, jobId, unit: alt ? { kind: alt.kind, id: alt.id, members: alt.members } : null, data: alt ? alt.data : null });
    }
    // 5) maintenance that fits after current work nearby
    for (const m of open.filter(j => j.tipo === "manutencao" && !(j.agenda && j.agenda.inicio))) {
      const near = open.find(j => j.tipo === "instalacao" && j.status === "andamento" && j.endereco && m.endereco && ((hasCoords(j.endereco) && hasCoords(m.endereco) && haversineKm(j.endereco, m.endereco) <= 3) || (j.endereco.bairro && norm(j.endereco.bairro) === norm(m.endereco.bairro))));
      if (near && (near._members || []).length) out.push({ key: `encaixe:${m.id}:${near.id}`, tipo: "encaixe", texto: `A manutenção de ${m.cliente} pode ser encaixada depois da obra atual de ${near._members.map(id => (ctx.installersById[id] || {}).nome).join(" e ")} em ${near.endereco.bairro || "local próximo"}.`, jobId: m.id });
    }
    const seen = new Set();
    return out.filter(s => !seen.has(s.key) && seen.add(s.key));
  }

  /* ======================================================================
   * 13. Performance analytics
   * ==================================================================== */
  function performance(ctx, from, to) {
    const rows = [];
    for (const inst of ctx.installers || []) {
      const mine = ctx.jobs.filter(j => (j._members || []).includes(inst.id));
      const done = mine.filter(j => j.status === "concluida" && j.real && j.real.fim && tsParts(j.real.fim).date >= from && tsParts(j.real.fim).date <= to);
      let onTime = 0, late = 0, lateInstaller = 0, estH = 0, realDays = 0, estDays = 0, qtyRate = [];
      const causes = {};
      for (const j of done) {
        const al = allocate(j, ctx);
        const actualEnd = tsParts(j.real.fim).date;
        if (al.fim && actualEnd <= al.fim) onTime++;
        else if (al.fim) { late++; const c = j.atrasoCausa || "nao_informado"; causes[c] = (causes[c] || 0) + 1; if (c === "instalador") lateInstaller++; }
        if (al.horas) estH += al.horas;
        if (j.real.inicio) {
          const d = workingDaysBetween(tsParts(j.real.inicio).date, actualEnd, ctx.cfg);
          realDays += d; estDays += al.blocks.length;
          const it = (j.itens || [])[0];
          if ((j.itens || []).length === 1 && it.qtd > 0 && !it.unidadeInferida && d > 0) qtyRate.push({ mat: it.mat, rate: it.qtd / d / Math.max(1, (j._members || []).length) });
        }
      }
      let cap = 0, used = 0, schedDays = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (blockedOn(inst, d)) continue;
        const day = installerDay(inst, ctx.cfg, d);
        cap += capacityMin(day);
        const bl = (ctx.occ[inst.id] || {})[d] || [];
        if (bl.length) schedDays++;
        used += bl.reduce((s, b) => s + (b.end - b.start), 0);
      }
      const rework = ctx.jobs.filter(m => m.retrabalho && m.manutencaoDe && done.some(j => j.id === m.manutencaoDe)).length;
      rows.push({
        id: inst.id, nome: inst.nome, concluidas: done.length,
        noPrazoPct: done.length ? Math.round((onTime / Math.max(1, onTime + late)) * 100) : null,
        atrasos: late, atrasosInstalador: lateInstaller, causas: causes,
        diasEstimados: estDays, diasReais: realDays,
        produtividade: qtyRate.length ? qtyRate : null,
        diasAgendados: schedDays,
        ociosidadePct: cap ? Math.max(0, Math.round((1 - used / cap) * 100)) : null,
        retrabalhos: rework
      });
    }
    return rows;
  }

  /* ======================================================================
   * 14. Roles and permissions (UI policy mirrors the data-layer rules below)
   * ==================================================================== */
  const ROLES = {
    admin: { label: "Administrador" }, coordenador: { label: "Coordenador" },
    instalador: { label: "Instalador" }, visualizador: { label: "Visualizador" }
  };
  const PERMISSIONS = {
    "obra.ver_todas": ["admin", "coordenador"],
    "obra.editar": ["admin", "coordenador"],
    "obra.excluir": ["admin", "coordenador"],
    "instalador.editar": ["admin", "coordenador"],
    "config.editar": ["admin"],
    "acessos.editar": ["admin"],
    "campo.registrar": ["instalador"],
    "quadro.ver": ["admin", "coordenador", "visualizador"]
  };
  function can(role, action) { return (PERMISSIONS[action] || []).includes(role); }

  /**
   * Data-layer rules declared with the published page. Enforced by the platform, not by the UI:
   *  - jobs, installers, teams, alerts: only Editors/Owner (admin level) read or write;
   *  - configuration and access roster: only the Owner writes;
   *  - acesso/<userId>: a per-person projection (installer agenda or read-only board) that only
   *    that person (and admins) can read; only admins write it;
   *  - campo/<userId>: each installer writes only their own field events; admins read all.
   */
  const DB_RULES = [
    { path: "", read: "admin", write: "admin" },
    { path: "cfg", read: "admin", write: "owner" },
    { path: "acesso", read: "admin", write: "admin" },
    { path: "acesso/{self}", read: "view", write: "admin" },
    { path: "campo", read: "admin", write: "admin" },
    { path: "campo/{self}", read: "interact", write: "interact" }
  ];

  /** Minimal evaluator of DB_RULES (used by tests to prove the policy). */
  const LEVEL = { none: -1, view: 0, interact: 1, admin: 2, owner: 3 };
  function ruleAllows(rules, path, action, level, selfId) {
    const segs = path.split("/").filter(Boolean);
    let best = null, bestLen = -1, viaSelf = false;
    for (const r of rules) {
      const rs = r.path.split("/").filter(Boolean);
      if (rs.length > segs.length) continue;
      let ok = true, self = false;
      for (let i = 0; i < rs.length; i++) {
        if (rs[i] === "{self}") { if (segs[i] !== selfId) { ok = false; break; } self = true; }
        else if (rs[i] !== segs[i]) { ok = false; break; }
      }
      if (ok && r[action] && rs.length > bestLen) { best = r; bestLen = rs.length; viaSelf = self; }
    }
    if (!best) return false;
    return LEVEL[level] >= LEVEL[best[action]];
  }

  /* ======================================================================
   * 15. Migration v1 (free-text installer) → v2 (profiles, structured items)
   * ==================================================================== */
  const MATERIAL_KEYWORDS = [
    [/SPC/, "spc"], [/90\s*[X×]\s*90/, "vinilico_90"], [/60\s*[X×]\s*60/, "vinilico_60"], [/REGUA/, "vinilico_reguas"],
    [/CALIZA|VEXA|PLACA VINIL/, "placa_vinilica"], [/VINIL/, "vinilico"], [/RIPADO/, "ripado"], [/TETO/, "teto_laminado"], [/CHATEAU/, "chateau_mur"],
    [/BAMBU|FLEXIVEL/, "bambu"], [/PAINEL LAMINADO/, "painel_laminado"], [/BOISERIE/, "boiserie"],
    [/RODAPE/, "rodape"], [/FRISO|ACABAMENTO/, "acabamentos"]
  ];
  function materialsFromText(text) {
    const parts = norm(text).split(/\s*\+\s*|\s*,\s*|\s+E\s+/).filter(Boolean);
    const out = [];
    for (const p of parts.length ? parts : [norm(text)]) {
      const hit = MATERIAL_KEYWORDS.find(([re]) => re.test(p));
      const id = hit ? hit[1] : "outro";
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }
  function parseQuantity(text) {
    const s = norm(text).replace(",", ".");
    const m = /(\d+(?:\.\d+)?)\s*(M2|M²|METROS? QUADRADOS?|ML|M\b|METROS?|PECAS?|PLACAS?|UNIDADES?|UN)?/.exec(s);
    if (!m) return null;
    const qtd = Number(m[1]);
    const u = m[2] || "";
    const unidade = /M2|M²|QUADRAD/.test(u) ? "m²" : /^ML$|^M$|METRO/.test(u) ? "m" : /PECA/.test(u) ? "peças" : /PLACA/.test(u) ? "placas" : /UN/.test(u) ? "un" : null;
    return { qtd, unidade };
  }
  const titleCase = s => String(s).toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  function makeId(prefix, seed) {
    let h = 2166136261;
    for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return `${prefix}_${(h >>> 0).toString(36)}`;
  }

  /**
   * Plan a non-destructive migration. Pure: returns what to write; the caller backs up the
   * originals first. Name merge rule: names equal after accent/case/space normalisation are the
   * same person; "A E B" / "A + B" / "A/B" become a team of A and B. Nothing else is merged.
   */
  function planMigration(legacyJobs, existing) {
    existing = existing || { installers: [], teams: [] };
    const byKey = new Map(existing.installers.map(i => [norm(i.nome), i]));
    const teamsByKey = new Map(existing.teams.map(t => [norm(t.nome), t]));
    const newInstallers = [], newTeams = [], jobs = [], report = { pessoas: [], equipes: [], obras: 0, materiaisNaoReconhecidos: [] };
    const ensureInst = name => {
      const k = norm(name);
      if (byKey.has(k)) return byKey.get(k);
      const inst = { id: makeId("ins", k), nome: titleCase(name.trim()), ativo: true, materiais: {}, produtividade: {}, fazManutencao: true, lider: false, semana: null, bloqueios: [], bairros: [], fone: "", notas: "Criado automaticamente a partir da agenda antiga. Revise materiais e produtividade.", origem: "migracao" };
      byKey.set(k, inst); newInstallers.push(inst); report.pessoas.push(inst.nome);
      return inst;
    };
    for (const j of legacyJobs) {
      if (j.v === 2) continue;
      const raw = String(j.instalador || "").trim();
      let instaladorIds = [], equipeId = null;
      if (raw) {
        const names = raw.split(/\s+E\s+|\s*\+\s*|\s*\/\s*|\s*,\s*|\s+&\s+/i).map(s => s.trim()).filter(Boolean);
        const insts = names.map(ensureInst);
        if (insts.length > 1) {
          const k = norm(raw);
          let team = teamsByKey.get(k);
          if (!team) {
            team = { id: makeId("eq", k), nome: titleCase(raw), membros: insts.map(i => i.id), lider: insts[0].id, origem: "migracao" };
            teamsByKey.set(k, team); newTeams.push(team); report.equipes.push(team.nome);
          }
          equipeId = team.id;
        } else instaladorIds = [insts[0].id];
      }
      const mats = j.material ? materialsFromText(j.material) : [];
      if (mats.includes("outro")) report.materiaisNaoReconhecidos.push(j.material);
      const q = parseQuantity(j.qtd || "");
      const itens = mats.map((mat, idx) => ({
        mat, label: mat === "outro" ? String(j.material).trim() : MAT[mat].label,
        qtd: idx === 0 && mats.length === 1 && q ? q.qtd : null,
        unidade: idx === 0 && mats.length === 1 && q ? (q.unidade || MAT[mat].unit) : MAT[mat].unit,
        unidadeInferida: !!(idx === 0 && mats.length === 1 && q && !q.unidade)
      }));
      // Experience is a fact from history: installers who executed a material get rating 3 ("registrada").
      for (const id of equipeId ? (newTeams.concat(existing.teams).find(t => t.id === equipeId) || { membros: [] }).membros : instaladorIds) {
        const inst = [...byKey.values()].find(i => i.id === id);
        for (const m of mats) if (m !== "outro" && !(inst.materiais[m] > 0)) inst.materiais[m] = 3;
      }
      const v2 = {
        v: 2,
        tipo: j.tipo === "manutencao" ? "manutencao" : "instalacao",
        status: ["agendada", "andamento", "pausada", "concluida"].includes(j.status) ? j.status : "agendada",
        prio: j.prio || "",
        cliente: j.cliente || "Cliente sem nome",
        fone: j.fone || "",
        endereco: { completo: "", bairro: j.local || "", ref: "", lat: null, lng: null },
        itens,
        materialOriginal: j.material || "", qtdOriginal: j.qtd || "",
        complexidade: "normal",
        servico: j.servico || "",
        obs: j.obs || "",
        equipeNecessaria: equipeId ? (newTeams.concat(existing.teams).find(t => t.id === equipeId) || { membros: [1] }).membros.length : 1,
        instaladorIds, equipeId,
        agenda: { inicio: j.inicio || "", hora: "08:00", horas: null, fimLegado: j.fim || "" },
        prontidao: {},
        real: j.status === "andamento" || j.status === "concluida" ? { inicio: j.inicio ? `${j.inicio}T12:00:00.000Z` : null, fim: null, aproximado: true } : {},
        atividade: [], hist: Array.isArray(j.hist) ? j.hist : [],
        criado: j.criado || null, atualizado: j.atualizado || null
      };
      jobs.push({ id: j.id, data: v2, legacy: j });
      report.obras++;
    }
    return { installers: newInstallers, teams: newTeams, jobs, report };
  }

  /** Hours for a migrated job whose old record had start AND end dates (fills agenda.horas). */
  function legacyHours(job, cfg) {
    const a = job.agenda || {};
    if (!a.inicio || !a.fimLegado || a.horas) return null;
    let mins = 0;
    for (let d = a.inicio; d <= a.fimLegado; d = addDays(d, 1)) mins += capacityMin(companyDay(cfg, d));
    return mins ? mins / 60 : null;
  }

  /* ======================================================================
   * 16. WhatsApp deep links (opens WhatsApp; never claims delivery)
   * ==================================================================== */
  function waNumber(f) { let d = String(f || "").replace(/\D/g, ""); if (d.length < 10) return null; if (!d.startsWith("55")) d = "55" + d; return d; }
  function waLink(fone, text) { const n = waNumber(fone); return n ? `https://wa.me/${n}${text ? "?text=" + encodeURIComponent(text) : ""}` : null; }
  function waTemplates(job, ctx) {
    const a = job.agenda || {};
    const quando = a.inicio ? `${fmtDate(a.inicio)}${a.hora ? `, às ${a.hora}` : ""}` : "[DATA]";
    const end = [job.endereco && job.endereco.completo, job.endereco && job.endereco.bairro].filter(Boolean).join(" — ");
    const mats = (job.itens || []).map(i => `${i.label || (MAT[i.mat] || {}).label}${i.qtd ? ` (${fmtNum(i.qtd)} ${i.unidade || ""})` : ""}`).join(", ");
    return {
      cliente: [
        { id: "confirmar", label: "Confirmar data", text: `Olá, ${job.cliente}! Sua instalação com a Mercatto Decor está agendada para ${quando}. Gostaríamos de confirmar se o local estará disponível.` },
        { id: "mudanca", label: "Avisar mudança de agenda", text: `Olá, ${job.cliente}! Precisamos ajustar a agenda da sua instalação com a Mercatto Decor. A nova data prevista é ${quando}. Esse horário funciona para você?` },
        { id: "acesso", label: "Pedir liberação do local", text: `Olá, ${job.cliente}! Para a instalação de ${quando}, poderia confirmar se o local estará liberado e com acesso para a equipe da Mercatto Decor?` },
        { id: "conclusao", label: "Comunicar conclusão", text: `Olá, ${job.cliente}! A instalação da Mercatto Decor foi concluída. Obrigado pela confiança! Qualquer dúvida, estamos à disposição.` }
      ],
      instalador: [
        { id: "proxima", label: "Enviar próxima obra", text: `Próxima obra: ${job.cliente} — ${quando}.${end ? ` Endereço: ${end}.` : ""}${mats ? ` Material: ${mats}.` : ""}` },
        { id: "endereco", label: "Enviar endereço e instruções", text: `Obra ${job.cliente}.${end ? ` Endereço: ${end}.` : ""}${job.endereco && job.endereco.ref ? ` Referência: ${job.endereco.ref}.` : ""}${job.obs ? ` Instruções: ${job.obs}` : ""}` },
        { id: "remanejo", label: "Avisar remanejamento", text: `Atenção: a obra ${job.cliente} foi remanejada. Nova data: ${quando}. Confira na sua agenda.` }
      ]
    };
  }

  const api = {
    TZ, tsParts, nowParts, today, addDays, dow, diffDays, weekStart, toMin, fromMin, fmtDate, fmtTs, isDate, DOW_PT, DOW_SHORT, MONTH_PT,
    MATERIALS, MAT, UNITS, REFERENCE_PRODUCTIVITY, COMPLEXITY, STATUS, OCCUPYING, PRIORITY, READINESS, DELAY_CAUSES, DEFAULT_WEEK,
    defaultConfig, defaultHolidays, easter, norm, companyDay, installerDay, blockedOn, capacityMin, jobMembers, jobMaterials,
    estimateDuration, historicalProductivity, plannedHours, allocate, buildContext, buildOccupancy, occupyingBlocks, validateJob, validateAll, hasErrors,
    readiness, jobFlags, installerStatus, workload, nextFreeDay, haversineKm, parseCoords, hasCoords, referencePoint,
    recommend, nextAvailableDate, buildAlerts, buildSuggestions, performance, ROLES, PERMISSIONS, can, DB_RULES, ruleAllows,
    materialsFromText, parseQuantity, planMigration, legacyHours, makeId, waLink, waNumber, waTemplates, fmtNum, workingDaysBetween, relDay
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
