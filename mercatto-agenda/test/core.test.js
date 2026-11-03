/* Critical scheduling tests. Run: node --test test/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/core.js");

// Fixed "now": Wednesday 2026-11-04 10:00 in Manaus (14:00 UTC).
const NOW = new Date("2026-11-04T14:00:00Z");
const MON = "2026-11-09", TUE = "2026-11-10", WED = "2026-11-11", THU = "2026-11-12";

function inst(id, over) {
  return { id, nome: id.toUpperCase(), ativo: true, materiais: { spc: 5, vinilico: 3 }, produtividade: {}, fazManutencao: true, bloqueios: [], ...(over || {}) };
}
function job(id, over) {
  return {
    id, v: 2, tipo: "instalacao", status: "agendada", cliente: "Cliente " + id, prio: "",
    endereco: { bairro: "Centro" }, itens: [{ mat: "spc", qtd: 30, unidade: "m²" }], complexidade: "normal",
    equipeNecessaria: 1, instaladorIds: [], equipeId: null, agenda: { inicio: MON, hora: "08:00", horas: 8 }, prontidao: {}, ...(over || {})
  };
}
function ctxOf(data) {
  const cfg = C.defaultConfig(NOW);
  return C.buildContext({ cfg, installers: [], teams: [], jobs: [], ...data }, NOW);
}
const codes = issues => issues.map(i => i.code);

test("1. two overlapping jobs for the same installer conflict", () => {
  const ctx = ctxOf({ installers: [inst("ana")], jobs: [job("a", { instaladorIds: ["ana"] }), job("b", { instaladorIds: ["ana"], agenda: { inicio: MON, hora: "13:00", horas: 3 } })] });
  assert.ok(codes(C.validateJob(ctx.jobsById.b, ctx)).includes("SOBREPOSICAO"));
  assert.ok(C.hasErrors(C.validateJob(ctx.jobsById.a, ctx)));
});

test("2. a maintenance visit conflicts with an overlapping installation", () => {
  const ctx = ctxOf({ installers: [inst("ana")], jobs: [job("inst", { instaladorIds: ["ana"] }), job("man", { tipo: "manutencao", instaladorIds: ["ana"], agenda: { inicio: MON, hora: "09:00", horas: 2 } })] });
  assert.ok(codes(C.validateJob(ctx.jobsById.man, ctx)).includes("SOBREPOSICAO"));
});

test("3. a team assignment reserves every team member", () => {
  const team = { id: "eq1", nome: "Equipe 1", membros: ["ana", "bia"], lider: "ana" };
  const ctx = ctxOf({ installers: [inst("ana"), inst("bia")], teams: [team], jobs: [job("t", { equipeId: "eq1", equipeNecessaria: 2 }), job("solo", { instaladorIds: ["bia"], agenda: { inicio: MON, hora: "10:00", horas: 2 } })] });
  assert.ok((ctx.occ.ana || {})[MON] && (ctx.occ.bia || {})[MON], "both members occupied");
  const issues = C.validateJob(ctx.jobsById.solo, ctx);
  assert.ok(issues.some(i => i.code === "SOBREPOSICAO" && i.otherJobId === "t"));
});

test("4. a multiday installation occupies every working day it spans", () => {
  const ctx = ctxOf({ installers: [inst("ana")], jobs: [job("big", { instaladorIds: ["ana"], agenda: { inicio: MON, hora: "08:00", horas: 24 } })] });
  const al = C.allocate(ctx.jobsById.big, ctx);
  assert.deepEqual(al.blocks.map(b => b.date), [MON, TUE, WED]);
  assert.equal(al.blocks.reduce((s, b) => s + b.work, 0), 24 * 60);
  for (const d of [MON, TUE, WED]) assert.ok(ctx.occ.ana[d], "occupied " + d);
  assert.equal(ctx.occ.ana[THU], undefined);
  // Friday start of 16 h skips the weekend correctly: Fri 8h + Sat 4h + Mon 4h
  const fri = C.allocate(job("f", { agenda: { inicio: "2026-11-13", hora: "08:00", horas: 16 } }), ctx);
  assert.deepEqual(fri.blocks.map(b => b.date), ["2026-11-13", "2026-11-14", "2026-11-16"]);
});

test("5. work scheduled during an installer vacation is rejected", () => {
  const ana = inst("ana", { bloqueios: [{ de: TUE, ate: WED, tipo: "ferias", motivo: "Férias" }] });
  const ctx = ctxOf({ installers: [ana], jobs: [job("v", { instaladorIds: ["ana"], agenda: { inicio: MON, hora: "08:00", horas: 16 } })] });
  const issues = C.validateJob(ctx.jobsById.v, ctx);
  assert.ok(issues.some(i => i.code === "INDISPONIVEL" && i.date === TUE && i.severity === "erro"));
  const rec = C.recommend(ctx.jobsById.v, ctx);
  assert.ok(rec.rejeitados.some(r => r.id === "ana"), "vacationing installer is not recommended");
});

test("6. installers without the required material expertise are excluded", () => {
  const ctx = ctxOf({ installers: [inst("ana"), inst("caio", { materiais: { teto_laminado: 5 } })], jobs: [job("n", { agenda: { inicio: MON, hora: "08:00", horas: 8 } })] });
  const rec = C.recommend(ctx.jobsById.n, ctx);
  assert.deepEqual(rec.candidatos.map(c => c.id), ["ana"]);
  assert.ok(rec.rejeitados.find(r => r.id === "caio").motivos.some(m => m.includes("Piso SPC")));
});

test("7. changing a job date recalculates conflicts", () => {
  const data = { installers: [inst("ana")], jobs: [job("a", { instaladorIds: ["ana"] }), job("b", { instaladorIds: ["ana"], agenda: { inicio: TUE, hora: "08:00", horas: 8 } })] };
  let ctx = ctxOf(data);
  assert.equal(C.validateJob(ctx.jobsById.b, ctx).filter(i => i.severity === "erro").length, 0);
  const moved = { ...ctx.jobsById.b, agenda: { ...ctx.jobsById.b.agenda, inicio: MON } };
  assert.ok(codes(C.validateJob(moved, ctx)).includes("SOBREPOSICAO"));
  // and the stored side recomputes too once the change is saved
  ctx = ctxOf({ ...data, jobs: [data.jobs[0], { ...data.jobs[1], agenda: { ...data.jobs[1].agenda, inicio: MON } }] });
  assert.ok(Object.keys(C.validateAll(ctx)).includes("a"));
});

test("8. completing a job records actual timestamps and frees the installer", () => {
  const running = job("r", { status: "andamento", instaladorIds: ["ana"], agenda: { inicio: "2026-11-03", hora: "08:00", horas: 16 }, real: { inicio: "2026-11-03T12:00:00Z" } });
  let ctx = ctxOf({ installers: [inst("ana")], jobs: [running] });
  assert.ok((ctx.occ.ana || {})["2026-11-04"], "occupied while running");
  assert.equal(C.installerStatus(ctx.installersById.ana, ctx, []).code, "em_obra_escritorio");
  const done = { ...running, status: "concluida", real: { inicio: running.real.inicio, fim: NOW.toISOString() } };
  ctx = ctxOf({ installers: [inst("ana")], jobs: [done] });
  assert.equal(C.tsParts(done.real.fim).date, "2026-11-04");
  assert.equal((ctx.occ.ana || {})["2026-11-04"], undefined);
  assert.equal(C.installerStatus(ctx.installersById.ana, ctx, []).code, "disponivel");
});

test("9. legacy jobs remain accessible after migration (non-destructive, ids kept)", () => {
  const legacy = [
    { id: "x1", cliente: "JANARY", instalador: "SONY E VANDER", material: "TETO RIPADO", qtd: "", inicio: "2026-09-15", fim: "2026-10-20", status: "pausada", obs: "aguardando material" },
    { id: "x2", cliente: "KAREN", instalador: "Vander", material: "Ripado", inicio: "2026-11-06", status: "agendada", tipo: "manutencao", servico: "Remoção" },
    { id: "x3", cliente: "ALEX", instalador: "AILTON", material: "Piso vinílico 90 × 90", qtd: "60 M2", inicio: "2026-11-03", fim: "2026-11-05", status: "agendada" },
    { id: "x4", cliente: "SEM NOME DE INSTALADOR", instalador: "", material: "RIPADO + TETO LAMINADO", status: "agendada" }
  ];
  const plan = C.planMigration(legacy);
  assert.equal(plan.jobs.length, 4);
  assert.deepEqual(plan.jobs.map(j => j.id), ["x1", "x2", "x3", "x4"]);
  assert.deepEqual(plan.installers.map(i => i.nome).sort(), ["Ailton", "Sony", "Vander"]);
  assert.equal(plan.teams.length, 1);
  const vander = plan.installers.find(i => i.nome === "Vander");
  assert.equal(plan.jobs[1].data.instaladorIds[0], vander.id, "case-insensitive same person");
  assert.ok(plan.teams[0].membros.includes(vander.id));
  const x3 = plan.jobs[2].data;
  assert.equal(x3.itens[0].mat, "vinilico_90");
  assert.equal(x3.itens[0].qtd, 60);
  assert.equal(x3.itens[0].unidade, "m²");
  assert.equal(x3.cliente, "ALEX");
  assert.equal(plan.jobs[0].data.status, "pausada");
  assert.equal(plan.jobs[0].data.obs, "aguardando material");
  assert.deepEqual(plan.jobs[3].data.itens.map(i => i.mat), ["ripado", "teto_laminado"]);
  assert.equal(C.planMigration(plan.jobs.map(j => ({ id: j.id, ...j.data }))).jobs.length, 0, "idempotent");
  const cfg = C.defaultConfig(NOW);
  assert.equal(C.legacyHours(x3, cfg), 24, "start/end dates preserved as planned hours");
});

test("10. read-only users cannot modify records (data layer and UI policy)", () => {
  const R = C.DB_RULES;
  assert.equal(C.ruleAllows(R, "obras/x1", "write", "view", "u_v"), false);
  assert.equal(C.ruleAllows(R, "obras/x1", "read", "view", "u_v"), false);
  assert.equal(C.ruleAllows(R, "acesso/u_v", "read", "view", "u_v"), true, "own board readable");
  assert.equal(C.ruleAllows(R, "acesso/u_v", "write", "view", "u_v"), false);
  assert.equal(C.ruleAllows(R, "campo/u_v", "write", "view", "u_v"), false);
  assert.equal(C.can("visualizador", "obra.editar"), false);
  assert.equal(C.can("admin", "obra.editar"), true);
});

test("11. installers cannot modify unrelated assignments", () => {
  const R = C.DB_RULES;
  assert.equal(C.ruleAllows(R, "obras/x1", "write", "interact", "u_i"), false);
  assert.equal(C.ruleAllows(R, "obras/x1", "read", "interact", "u_i"), false, "no access to other customers");
  assert.equal(C.ruleAllows(R, "campo/u_i", "write", "interact", "u_i"), true, "own field log");
  assert.equal(C.ruleAllows(R, "campo/u_other", "write", "interact", "u_i"), false);
  assert.equal(C.ruleAllows(R, "acesso/u_other", "read", "interact", "u_i"), false);
  assert.equal(C.ruleAllows(R, "cfg/main", "write", "admin", "u_e"), false, "only the owner changes settings");
  assert.equal(C.ruleAllows(R, "cfg/main", "write", "owner", "u_o"), true);
  assert.equal(C.can("instalador", "obra.editar"), false);
  assert.equal(C.can("instalador", "campo.registrar"), true);
});

test("12. business dates use Manaus time, not UTC or the browser zone", () => {
  // 02:30 UTC on Nov 5 is still Nov 4, 22:30 in Manaus.
  const p = C.tsParts("2026-11-05T02:30:00Z");
  assert.equal(p.date, "2026-11-04");
  assert.equal(p.time, "22:30");
  assert.equal(C.today(new Date("2026-11-05T03:59:00Z")), "2026-11-04");
  assert.equal(C.today(new Date("2026-11-05T04:00:00Z")), "2026-11-05");
  assert.equal(C.fmtDate("2026-11-04"), "04/11/2026");
  assert.equal(C.fmtTs("2026-11-05T02:30:00Z"), "04/11/2026 às 22:30");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.dow("2026-11-09"), 1);
});

test("13. browser-only mode never claims cross-device sync", () => {
  const Store = require("../src/store.js");
  const s = Store.describeMode("local");
  assert.equal(s.shared, false);
  assert.match(s.label, /só neste navegador/i);
  assert.doesNotMatch(s.label, /sincroniz(ad|a) entre/i);
  assert.equal(Store.describeMode("db").shared, true);
});

test("14. missing coordinates never produce fabricated distances", () => {
  const ctx = ctxOf({ installers: [inst("ana"), inst("bia")], jobs: [job("prev", { instaladorIds: ["ana"], endereco: { bairro: "Adrianópolis" } })] });
  const fresh = job("novo", { endereco: { bairro: "Ponta Negra" }, agenda: { inicio: TUE, hora: "08:00", horas: 8 } });
  const rec = C.recommend(fresh, ctx);
  for (const c of rec.todos) { assert.equal(c.km, null); assert.equal(c.factors.proximity, undefined); assert.ok(c.fatoresAusentes.includes("proximity")); }
  assert.equal(C.parseCoords("Adrianópolis"), null);
  const withCoords = C.parseCoords("https://www.google.com/maps/@-3.1032,-60.0128,17z");
  assert.ok(withCoords.dentroDeManaus);
  const d = C.haversineKm({ lat: -3.1032, lng: -60.0128 }, { lat: -3.0880, lng: -60.0500 });
  assert.ok(d > 4 && d < 5, "straight-line km " + d);
});

test("15. recommendations are deterministic for identical inputs", () => {
  const data = { installers: [inst("bia"), inst("ana"), inst("caio", { materiais: { spc: 4 } })], jobs: [] };
  const j = job("n", { agenda: { inicio: TUE, hora: "08:00", horas: 8 } });
  const a = C.recommend(j, ctxOf(data)), b = C.recommend(j, ctxOf(JSON.parse(JSON.stringify(data))));
  assert.deepEqual(a.candidatos.map(c => [c.id, c.score]), b.candidatos.map(c => [c.id, c.score]));
  assert.deepEqual(a.candidatos.map(c => c.id), ["ana", "bia", "caio"], "ties broken by name");
});

test("16. a team member's new unavailability invalidates the team assignment", () => {
  const team = { id: "eq1", nome: "Equipe 1", membros: ["ana", "bia"] };
  const tj = job("t", { equipeId: "eq1", equipeNecessaria: 2 });
  let ctx = ctxOf({ installers: [inst("ana"), inst("bia")], teams: [team], jobs: [tj] });
  assert.equal(C.hasErrors(C.validateJob(ctx.jobsById.t, ctx)), false);
  ctx = ctxOf({ installers: [inst("ana"), inst("bia", { bloqueios: [{ de: MON, ate: MON, tipo: "folga", motivo: "Consulta médica" }] })], teams: [team], jobs: [tj] });
  const issues = C.validateJob(ctx.jobsById.t, ctx);
  assert.ok(issues.some(i => i.code === "INDISPONIVEL" && i.instId === "bia"));
  assert.ok(Object.keys(C.validateAll(ctx)).includes("t"));
});

test("day off, working hours and travel buffer are enforced", () => {
  const sat = { ...C.DEFAULT_WEEK, 6: { on: false, start: "08:00", end: "12:00", breakMin: 0 } };
  const ctx = ctxOf({ installers: [inst("ana", { semana: sat })], jobs: [job("s", { instaladorIds: ["ana"], agenda: { inicio: "2026-11-14", hora: "08:00", horas: 4 } }), job("x", { instaladorIds: ["ana"], agenda: { inicio: MON, hora: "08:00", horas: 3 }, endereco: { bairro: "Centro" } }), job("y", { instaladorIds: ["ana"], agenda: { inicio: MON, hora: "11:15", horas: 2 }, endereco: { bairro: "Ponta Negra" } })] });
  assert.ok(codes(C.validateJob(ctx.jobsById.s, ctx)).includes("DIA_DE_FOLGA"));
  assert.ok(codes(C.validateJob(ctx.jobsById.y, ctx)).includes("DESLOCAMENTO"));
});

test("duration estimate: 45 m² SPC, explicit sources, no invented precision", () => {
  const ana = inst("ana", { produtividade: { spc: 20 } });
  const ctx = ctxOf({ installers: [ana] });
  const e = C.estimateDuration(job("e", { itens: [{ mat: "spc", qtd: 45, unidade: "m²" }], instaladorIds: ["ana"] }), ctx);
  assert.equal(e.origem, "perfil");
  assert.equal(e.horas, 19); // 45/20 = 2.25 days × 8 h + 1 h setup
  const ref = C.estimateDuration(job("e2", { itens: [{ mat: "spc", qtd: 45, unidade: "m²" }] }), ctx);
  assert.equal(ref.origem, "referencia");
  assert.equal(C.estimateDuration(job("e3", { itens: [{ mat: "spc", qtd: null }] }), ctx).horas, null);
});

test("key workflow: new 45 m² SPC job gets an explained top-3 and updates capacity", () => {
  const installers = [
    inst("joao", { materiais: { spc: 5 }, produtividade: { spc: 25 } }),
    inst("carlos", { materiais: { spc: 4 }, produtividade: { spc: 20 } }),
    inst("davi", { materiais: { spc: 3 } }),
    inst("edu", { materiais: { teto_laminado: 5 } }),
    inst("fabio", { materiais: { spc: 5 }, bloqueios: [{ de: MON, ate: THU, tipo: "ferias" }] })
  ];
  const busy = job("busy", { instaladorIds: ["carlos"], agenda: { inicio: MON, hora: "08:00", horas: 4 } });
  let ctx = ctxOf({ installers, jobs: [busy] });
  const novo = job("novo", { status: "rascunho", itens: [{ mat: "spc", qtd: 45, unidade: "m²" }], agenda: { inicio: TUE, hora: "08:00" } });
  const rec = C.recommend(novo, ctx);
  assert.equal(rec.candidatos.length, 3);
  assert.equal(rec.candidatos[0].id, "joao");
  assert.ok(rec.candidatos[0].reasons.length >= 2);
  assert.ok(rec.rejeitados.some(r => r.id === "edu") && rec.rejeitados.some(r => r.id === "fabio"));
  const confirmed = { ...novo, status: "agendada", instaladorIds: ["joao"], agenda: { ...novo.agenda, horas: rec.candidatos[0].estimativa.horas } };
  ctx = ctxOf({ installers, jobs: [busy, confirmed] });
  assert.equal(C.hasErrors(C.validateJob(ctx.jobsById.novo, ctx)), false);
  assert.ok(C.workload(ctx.installersById.joao, ctx, MON, 7).ocupadoH > 0);
  const clash = { ...confirmed, id: "clash" };
  assert.ok(C.hasErrors(C.validateJob(clash, ctx)), "a second identical booking now conflicts");
});

test("an in-progress job without a usable duration still occupies its crew today", () => {
  const ctx = ctxOf({ installers: [inst("ana")], jobs: [job("old", { status: "andamento", instaladorIds: ["ana"], itens: [{ mat: "painel_laminado", qtd: null }], agenda: { inicio: "2026-09-22", hora: "08:00", horas: null } })] });
  assert.ok((ctx.occ.ana || {})["2026-11-04"], "occupied today");
  const clash = job("new", { instaladorIds: ["ana"], agenda: { inicio: "2026-11-04", hora: "09:00", horas: 2 } });
  assert.ok(codes(C.validateJob(clash, ctx)).includes("SOBREPOSICAO"));
});
