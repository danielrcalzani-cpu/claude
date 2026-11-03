/*
 * Mercatto Decor — data layer.
 *
 * Shared mode: the claude.ai artifact database (`claude.use("db")`) with access rules declared at
 * publish time (see Core.DB_RULES). Local mode: browser storage only, explicitly labelled as
 * not shared. The two are never mixed silently.
 *
 * Collections
 *   obras/{id}           jobs (v2 schema)
 *   instaladores/{id}    installer profiles
 *   equipes/{id}         teams
 *   cfg/main             settings (owner writes)
 *   cfg/acessos          people → role / installer link (owner writes)
 *   cfg/migracao         migration marker
 *   alertas/estado       dismissed alerts / suggestions
 *   backups/{stamp}-{n}  pre-migration copies of legacy jobs
 *   acesso/{userId}      per-person projection (installer agenda or read-only board)
 *   campo/{userId}       installer field events (check-in, pause, finish, problems)
 */
(function (root) {
  "use strict";

  function describeMode(mode) {
    if (mode === "db") return { shared: true, label: "Dados compartilhados com a equipe (sincronização em tempo real)." };
    if (mode === "local") return { shared: false, label: "Modo local: os dados ficam só neste navegador e não aparecem em outros aparelhos." };
    return { shared: false, label: "Conectando aos dados…" };
  }

  if (typeof module !== "undefined" && module.exports && typeof window === "undefined") {
    module.exports = { describeMode };
    return;
  }

  const Core = root.Core;
  const LS_V2 = "mercatto-agenda-v2", LS_V1 = "mercatto-agenda-obras-v1";
  const listeners = new Set();
  const S = {
    mode: "loading", role: null, uid: null, me: null, canWrite: false,
    cfg: null, installers: [], teams: [], jobs: [], acessos: { pessoas: [] }, alertState: { dispensados: {} },
    campo: {}, projection: null, migracao: null,
    pending: 0, failed: 0, lastError: null, online: typeof navigator === "undefined" ? true : navigator.onLine,
    fromCache: false, loaded: { obras: false, instaladores: false, equipes: false, cfg: false }, legacyCount: 0
  };
  let db = null, user = null, downloads = null, assets = null;
  let emitTimer = 0;
  const emit = () => { clearTimeout(emitTimer); emitTimer = setTimeout(() => listeners.forEach(f => f(S)), 16); };

  /* ---------- write tracking ---------- */
  async function track(promise) {
    S.pending++; emit();
    try { const r = await promise; S.lastError = null; return r; }
    catch (e) {
      S.failed++; S.lastError = e;
      if (e && e.code === "invalid_argument") throw Object.assign(new Error("Sem permissão para esta alteração."), { code: "forbidden", cause: e });
      if (e && e.code === "quota_exceeded") throw Object.assign(new Error("O armazenamento desta página está cheio."), { code: "quota", cause: e });
      throw Object.assign(new Error("Não foi possível salvar. Verifique a conexão e tente de novo."), { code: e && e.code || "unavailable", cause: e });
    }
    finally { S.pending--; emit(); }
  }

  /* ---------- local mode ---------- */
  function localLoad() {
    let v2 = null;
    try { v2 = JSON.parse(localStorage.getItem(LS_V2) || "null"); } catch (e) { v2 = null; }
    if (!v2) {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem(LS_V1) || "[]"); } catch (e) { legacy = []; }
      v2 = { cfg: null, installers: [], teams: [], jobs: legacy, acessos: { pessoas: [] }, alertState: { dispensados: {} } };
    }
    S.cfg = v2.cfg || Core.defaultConfig();
    S.installers = v2.installers || []; S.teams = v2.teams || []; S.jobs = v2.jobs || [];
    S.alertState = v2.alertState || { dispensados: {} };
    S.legacyCount = S.jobs.filter(j => j.v !== 2).length;
    S.migracao = v2.migracao || null;
  }
  function localSave() {
    try { localStorage.setItem(LS_V2, JSON.stringify({ cfg: S.cfg, installers: S.installers, teams: S.teams, jobs: S.jobs, acessos: S.acessos, alertState: S.alertState, migracao: S.migracao })); }
    catch (e) { throw Object.assign(new Error("O navegador não permitiu salvar (armazenamento cheio ou bloqueado)."), { code: "quota" }); }
  }
  function localUpsert(list, id, data, merge) {
    const i = S[list].findIndex(x => x.id === id);
    const val = merge && i > -1 ? deepMerge(S[list][i], data) : { ...data, id };
    if (i > -1) S[list][i] = val; else S[list].push(val);
  }
  function deepMerge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? deepMerge(a[k], v) : v;
    return out;
  }

  /* ---------- connect ---------- */
  async function connect() {
    try {
      if (root.claude && typeof root.claude.use === "function") {
        [db, user, downloads, assets] = await Promise.all(["db", "user", "downloads", "assets"].map(n => root.claude.use(n).catch(() => null)));
      }
    } catch (e) { db = null; }
    if (user) { try { S.me = await user.me(); S.uid = S.me.id; } catch (e) { S.me = null; } }

    if (!db) {
      S.mode = "local"; S.role = "admin"; S.canWrite = true;
      localLoad(); Object.keys(S.loaded).forEach(k => S.loaded[k] = true);
      emit(); return;
    }
    S.mode = "db";
    if (S.me && S.me.isOwner) S.role = "admin";
    else if (S.me && S.me.canEdit) S.role = "coordenador";
    else S.role = null;

    if (S.role === "admin" || S.role === "coordenador") {
      S.canWrite = true;
      subscribeCollection("obras", docs => { S.jobs = docs; S.legacyCount = docs.filter(j => j.v !== 2).length; });
      subscribeCollection("instaladores", docs => { S.installers = docs; });
      subscribeCollection("equipes", docs => { S.teams = docs; });
      subscribeDoc("cfg/main", d => { S.cfg = d ? { ...Core.defaultConfig(), ...d } : Core.defaultConfig(); S.loaded.cfg = true; });
      subscribeDoc("cfg/acessos", d => { S.acessos = d || { pessoas: [] }; });
      subscribeDoc("cfg/migracao", d => { S.migracao = d; });
      subscribeDoc("alertas/estado", d => { S.alertState = d || { dispensados: {} }; });
      db.collection("campo").onSnapshot(snap => {
        S.campo = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
        emit(); reconcile();
      }, onSubError);
    } else {
      // Installer or viewer: only their own projection (and own field log) is readable.
      S.canWrite = false;
      if (!S.uid) { S.role = "sem_acesso"; emit(); return; }
      subscribeDoc(`acesso/${S.uid}`, d => {
        S.projection = d;
        S.role = d && d.papel ? d.papel : "sem_acesso";
        S.loaded.cfg = true;
      });
      db.doc(`campo/${S.uid}`).onSnapshot(s => { S.campo = { [S.uid]: s.exists ? s.data() : { eventos: [] } }; emit(); }, onSubError);
    }
    emit();
  }
  function onSubError(e) { S.lastError = e; emit(); }
  function subscribeCollection(name, apply) {
    db.collection(name).onSnapshot(snap => {
      apply(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      S.loaded[name] = true; S.fromCache = snap.metadata && snap.metadata.fromCache;
      emit();
    }, onSubError);
  }
  function subscribeDoc(path, apply) {
    db.doc(path).onSnapshot(s => { apply(s.exists ? s.data() : null); emit(); }, onSubError);
  }

  /* ---------- writes (admin / coordinator) ---------- */
  const newId = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const stamp = () => ({ atualizado: new Date().toISOString(), atualizadoPor: S.uid || null });

  async function saveJob(id, data, opts) {
    opts = opts || {};
    if (!id) {
      id = newId("ob");
      const body = { ...data, v: 2, criado: new Date().toISOString(), ...stamp() };
      if (S.mode === "local") { localUpsert("jobs", id, body); localSave(); emit(); return id; }
      await track(db.doc(`obras/${id}`).set(body));
      return id;
    }
    const current = S.jobs.find(j => j.id === id);
    if (opts.expectedAtualizado && current && current.atualizado && current.atualizado !== opts.expectedAtualizado && !opts.force) {
      throw Object.assign(new Error("Esta obra foi alterada por outra pessoa enquanto você editava."), { code: "stale", current });
    }
    const body = { ...data, ...stamp() };
    if (S.mode === "local") { localUpsert("jobs", id, body, true); localSave(); emit(); return id; }
    await track(db.doc(`obras/${id}`).update(body));
    return id;
  }
  async function deleteJob(id) {
    if (S.mode === "local") { S.jobs = S.jobs.filter(j => j.id !== id); localSave(); emit(); return; }
    await track(db.doc(`obras/${id}`).delete());
  }
  async function saveEntity(coll, list, id, data, prefix) {
    id = id || newId(prefix);
    const body = { ...data, ...stamp() };
    delete body.id;
    if (S.mode === "local") { localUpsert(list, id, body); localSave(); emit(); return id; }
    await track(db.doc(`${coll}/${id}`).set(body));
    return id;
  }
  const saveInstaller = (id, d) => saveEntity("instaladores", "installers", id, d, "ins");
  const saveTeam = (id, d) => saveEntity("equipes", "teams", id, d, "eq");
  async function deleteTeam(id) {
    if (S.mode === "local") { S.teams = S.teams.filter(t => t.id !== id); localSave(); emit(); return; }
    await track(db.doc(`equipes/${id}`).delete());
  }
  async function saveCfg(cfg) {
    if (S.mode === "local") { S.cfg = cfg; localSave(); emit(); return; }
    await track(db.doc("cfg/main").set(cfg));
  }
  async function saveAcessos(a) {
    if (S.mode === "local") { S.acessos = a; localSave(); emit(); return; }
    await track(db.doc("cfg/acessos").set(a));
  }
  async function setAlertState(st) {
    if (S.mode === "local") { S.alertState = st; localSave(); emit(); return; }
    await track(db.doc("alertas/estado").set(st));
  }

  /* ---------- migration (backup first, then additive writes) ---------- */
  async function runMigration(plan, legacyJobs) {
    const when = new Date().toISOString();
    if (S.mode === "local") {
      try { localStorage.setItem(`mercatto-backup-${when}`, JSON.stringify(legacyJobs)); } catch (e) { throw Object.assign(new Error("Não foi possível guardar a cópia de segurança neste navegador."), { code: "quota" }); }
      for (const i of plan.installers) localUpsert("installers", i.id, i);
      for (const t of plan.teams) localUpsert("teams", t.id, t);
      for (const j of plan.jobs) localUpsert("jobs", j.id, { ...j.data, id: j.id });
      S.migracao = { feita: true, at: when, report: plan.report };
      localSave(); emit(); return;
    }
    const lease = await db.doc("cfg/migracao-trava").acquire({ holder: S.uid || "admin", ttlMs: 120000 }).catch(() => ({ acquired: true }));
    if (!lease.acquired) throw Object.assign(new Error("Outra pessoa está atualizando os dados agora. Tente em alguns minutos."), { code: "busy" });
    const chunks = [];
    for (let i = 0; i < legacyJobs.length; i += 40) chunks.push(legacyJobs.slice(i, i + 40));
    for (let n = 0; n < chunks.length; n++) await track(db.doc(`backups/${when.replace(/[:.]/g, "-")}-${n}`).set({ criado: when, parte: n, total: chunks.length, obras: chunks[n] }));
    for (const i of plan.installers) await track(db.doc(`instaladores/${i.id}`).set({ ...i, id: undefined, ...stamp() }).catch(e => { throw e; }));
    for (const t of plan.teams) await track(db.doc(`equipes/${t.id}`).set({ ...t, id: undefined, ...stamp() }));
    for (const j of plan.jobs) await track(db.doc(`obras/${j.id}`).set({ ...j.data, ...stamp() }));
    await track(db.doc("cfg/migracao").set({ feita: true, at: when, por: S.uid || null, report: plan.report }));
  }

  /* ---------- per-person projections (data-layer privacy) ---------- */
  const lastProjection = {};
  async function writeProjection(uid, payload) {
    if (S.mode !== "db" || !uid) return;
    const json = JSON.stringify(payload);
    if (lastProjection[uid] === json) return;
    lastProjection[uid] = json;
    try { await track(db.doc(`acesso/${uid}`).set(payload)); } catch (e) { delete lastProjection[uid]; throw e; }
  }
  async function removeProjection(uid) {
    if (S.mode !== "db" || !uid) return;
    delete lastProjection[uid];
    await track(db.doc(`acesso/${uid}`).delete());
  }

  /* ---------- field events ---------- */
  /** Installer side: append an event to the installer's own log. */
  async function addFieldEvent(ev) {
    const uid = S.uid;
    const log = (S.campo[uid] && S.campo[uid].eventos) || [];
    const e = { id: newId("ev"), at: new Date().toISOString(), ...ev };
    const next = [...log, e].slice(-300);
    if (S.mode === "local") { S.campo[uid || "local"] = { eventos: next }; emit(); return e; }
    await track(db.doc(`campo/${uid}`).set({ eventos: next }));
    return e;
  }

  /**
   * Admin side: copy new field events into the job documents (status, actual timestamps,
   * activity log). Idempotent by event id; serialised with a short lease across open admin tabs.
   */
  let reconciling = false;
  async function reconcile() {
    if (S.mode !== "db" || !(S.role === "admin" || S.role === "coordenador") || reconciling || !S.loaded.obras) return;
    const byUid = Object.fromEntries((S.acessos.pessoas || []).map(p => [p.id, p]));
    const todo = [];
    for (const [uid, doc] of Object.entries(S.campo)) {
      const person = byUid[uid];
      if (!person || person.papel !== "instalador" || !person.instaladorId) continue;
      for (const ev of (doc && doc.eventos) || []) {
        const job = S.jobs.find(j => j.id === ev.jobId);
        if (!job || (job.atividade || []).some(a => a.id === ev.id)) continue;
        if (!Core.jobMembers(job, S.teams).includes(person.instaladorId)) continue; // not their job: ignored
        todo.push({ ev: { ...ev, instId: person.instaladorId, por: uid, origem: "campo" }, job });
      }
    }
    if (!todo.length) return;
    reconciling = true;
    try {
      const lease = await db.doc("travas/reconciliador").acquire({ holder: S.uid || "admin", ttlMs: 20000 }).catch(() => ({ acquired: true }));
      if (!lease.acquired) return;
      const byJob = {};
      for (const t of todo) (byJob[t.job.id] = byJob[t.job.id] || { job: t.job, evs: [] }).evs.push(t.ev);
      for (const { job, evs } of Object.values(byJob)) {
        evs.sort((a, b) => a.at.localeCompare(b.at));
        const patch = applyEvents(job, evs);
        await track(db.doc(`obras/${job.id}`).update(patch));
      }
    } finally { reconciling = false; }
  }
  /** Pure: compute the job patch for a list of field events (exported for the UI's own actions). */
  function applyEvents(job, evs) {
    const atividade = [...(job.atividade || [])];
    const real = { ...(job.real || {}) };
    const pausas = [...(real.pausas || [])];
    let status = job.status, conclusao = job.conclusao || null, extra = {};
    for (const ev of evs) {
      atividade.push({ id: ev.id, tipo: ev.tipo, at: ev.at, por: ev.por || null, instId: ev.instId || null, origem: ev.origem || "escritorio", nota: ev.nota || "", fotos: ev.fotos || [] });
      if (ev.tipo === "inicio") { if (!real.inicio) real.inicio = ev.at; status = "andamento"; }
      if (ev.tipo === "pausa") { pausas.push({ de: ev.at, motivo: ev.nota || "", causa: ev.causa || null }); status = "pausada"; }
      if (ev.tipo === "retomada") { const p = pausas[pausas.length - 1]; if (p && !p.ate) p.ate = ev.at; status = "andamento"; }
      if (ev.tipo === "fim") {
        real.fim = ev.at; if (!real.inicio) real.inicio = ev.at; status = "concluida";
        conclusao = { notas: ev.nota || "", pendencias: ev.pendencias || "", fotos: ev.fotos || [], por: ev.por || null, at: ev.at };
        if (ev.causa) extra.atrasoCausa = ev.causa;
      }
    }
    real.pausas = pausas;
    return { atividade: atividade.slice(-200), real, status, ...(conclusao ? { conclusao } : {}), ...extra, ...stamp() };
  }

  /* ---------- photos ---------- */
  async function uploadPhoto(file) {
    if (!assets) throw Object.assign(new Error("O envio de fotos não está disponível para o seu acesso."), { code: "no_assets" });
    const blob = await downscale(file, 1600, 0.8);
    if (blob.size > 4 * 1024 * 1024) throw Object.assign(new Error("A foto ficou grande demais mesmo depois de reduzida."), { code: "too_big" });
    const r = await track(assets.upload(blob));
    return { id: r.id, url: r.url };
  }
  function downscale(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res(b) : rej(new Error("Não foi possível ler a imagem.")), "image/jpeg", q);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => rej(new Error("Não foi possível ler esta imagem."));
      img.src = URL.createObjectURL(file);
    });
  }

  async function saveFile(filename, data) {
    if (!downloads) throw Object.assign(new Error("O download não está disponível neste navegador."), { code: "no_downloads" });
    return downloads.save({ filename, data });
  }
  async function searchPeople(q) { return user && user.search ? user.search(q) : []; }
  async function profiles(ids) { return user && user.profiles && ids.length ? user.profiles(ids) : {}; }

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { S.online = true; emit(); });
    window.addEventListener("offline", () => { S.online = false; emit(); });
  }

  root.Store = {
    S, connect, describeMode, subscribe: f => { listeners.add(f); return () => listeners.delete(f); },
    saveJob, deleteJob, saveInstaller, saveTeam, deleteTeam, saveCfg, saveAcessos, setAlertState,
    runMigration, writeProjection, removeProjection, addFieldEvent, applyEvents, uploadPhoto, saveFile,
    searchPeople, profiles, hasAssets: () => !!assets, hasDownloads: () => !!downloads, newId
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
