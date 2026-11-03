/*
 * Browser end-to-end check (Playwright) against an in-memory stand-in for the claude.ai db.
 * Usage: node test/e2e.js <mock.js> <legacy-jobs.json> <outDir>
 * Seeds legacy (v1) jobs, runs the migration through the UI, creates the key 45 m² SPC job with
 * the recommendation engine, drags a job in the weekly calendar and checks the installer view.
 */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [mockPath, dataPath, out] = process.argv.slice(2);
const page = path.resolve(__dirname, "../dist/agenda-de-obras.html");
const legacy = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const seed = `window.__seed=${JSON.stringify(legacy)};` + fs.readFileSync(mockPath, "utf8") +
  `;for(const d of window.__seed){const x={...d};const id=x.id;delete x.id;window.__store.set('obras/'+id,x);}`;
const errors = [];
const shot = async (p, name, full) => p.screenshot({ path: path.join(out, name + ".png"), fullPage: !!full });
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); console.log("ok -", m); };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.addInitScript({ content: seed });
  await p.goto("file://" + page + "#pc");
  await p.waitForTimeout(1200);
  await shot(p, "01-central-before-migration");
  assert(await p.isVisible("text=Atualização de dados disponível"), "legacy data shown as preview with migration banner");

  // migration
  await p.click("[data-migrate]"); await p.waitForTimeout(300);
  await shot(p, "02-migration-dialog");
  await p.click("#migOk"); await p.waitForTimeout(1500);
  const counts = await p.evaluate(() => { const s = window.__store; const k = [...s.keys()]; return { obras: k.filter(x => x.startsWith("obras/")).length, inst: k.filter(x => x.startsWith("instaladores/")).length, eq: k.filter(x => x.startsWith("equipes/")).length, bk: k.filter(x => x.startsWith("backups/")).length, v2: k.filter(x => x.startsWith("obras/") && s.get(x).v === 2).length }; });
  console.log(counts);
  assert(counts.obras === legacy.length && counts.v2 === legacy.length, "all jobs migrated, same ids");
  assert(counts.bk >= 1, "backup written before migration");
  assert(counts.inst >= 6, "installer profiles created");
  await shot(p, "03-central");

  // give one installer explicit SPC skill + productivity via the profile editor
  await p.goto("file://" + page + "#instaladores"); await p.waitForTimeout(600);
  await shot(p, "04-instaladores");
  await p.click("article:has-text('Gabriel') [data-inst-edit]"); await p.waitForTimeout(300);
  await p.click("[data-itab=esp]"); await p.waitForTimeout(200);
  await p.click("[data-rate='spc|5']"); await p.fill("[data-prod=spc]", "25");
  await shot(p, "05-profile-skills");
  await p.click("[data-inst-save]"); await p.waitForTimeout(600);
  await p.click("article:has-text('Ailton') [data-inst-edit]"); await p.waitForTimeout(300);
  await p.click("[data-itab=esp]"); await p.click("[data-rate='spc|4']"); await p.click("[data-inst-save]"); await p.waitForTimeout(600);

  // key workflow: new 45 m² SPC installation
  await p.goto("file://" + page + "#central"); await p.waitForTimeout(500);
  await p.click("#btnNewTop"); await p.waitForTimeout(300);
  await p.fill("#fCli", "Teste SPC 45 m²"); await p.fill("#fBairro", "Adrianópolis");
  await p.click("[data-next]"); await p.waitForTimeout(200);
  await p.selectOption("[data-it=mat]", "spc"); await p.waitForTimeout(200);
  await p.fill("[data-it=qtd]", "45");
  await p.click("[data-next]"); await p.waitForTimeout(200);
  const nextMon = await p.evaluate(() => { const C = window.Core; let d = C.addDays(C.today(), 1); while (C.dow(d) !== 1) d = C.addDays(d, 1); return d; });
  await p.fill("#fIni", nextMon); await p.dispatchEvent("#fIni", "input");
  await p.click("[data-recommend]"); await p.waitForTimeout(500);
  await shot(p, "06-recommendation");
  const cands = await p.$$eval(".cand", els => els.map(e => e.innerText.split("\n").slice(0, 3).join(" | ")));
  console.log(cands);
  assert(cands.length >= 1, "recommendations shown");
  await p.click("[data-pick='0']"); await p.waitForTimeout(300);
  await p.click("[data-next]"); await p.click("[data-next]"); await p.waitForTimeout(200);
  await shot(p, "07-confirm");
  await p.click("[data-save=confirm]"); await p.waitForTimeout(700);
  const created = await p.evaluate(() => [...window.__store.entries()].filter(([k, v]) => k.startsWith("obras/") && v.cliente === "Teste SPC 45 m²").map(([, v]) => v)[0]);
  assert(created && created.instaladorIds.length === 1 && created.agenda.inicio, "job saved with assignment and date");
  assert(created.estimativa && created.estimativa.horas > 0, "duration estimate stored: " + JSON.stringify(created.estimativa));

  // weekly calendar + drag to create conflict
  await p.goto("file://" + page + "#agenda"); await p.waitForTimeout(600);
  await p.click("[data-agnav='1']"); await p.waitForTimeout(400);
  await shot(p, "08-agenda-week");
  const blk = await p.$("[data-drag]");
  if (blk) {
    await p.dragAndDrop("[data-drag]", ".cell[data-cell]:not(.off)"); await p.waitForTimeout(500);
    await shot(p, "09-drag-validate");
    assert(await p.isVisible("#mvCheck"), "drag opens validated reschedule dialog");
    await p.click("dialog [data-x]");
  }
  await p.click("[data-agv=dia]"); await p.waitForTimeout(300); await shot(p, "10-agenda-day");
  await p.click("[data-agv=mes]"); await p.waitForTimeout(300); await shot(p, "11-agenda-month");
  for (const r of ["instalacoes", "manutencoes", "mapa", "desempenho", "ajustes"]) { await p.goto("file://" + page + "#" + r); await p.waitForTimeout(500); await shot(p, "12-" + r); }
  await p.goto("file://" + page + "#central"); await p.waitForTimeout(500);
  await p.click(".jcard .customer, [data-open]"); await p.waitForTimeout(400); await shot(p, "13-detail");

  // phone layout
  const m = await b.newContext({ viewport: { width: 400, height: 860 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148" });
  const mp = await m.newPage();
  mp.on("pageerror", e => errors.push("mobile: " + e.message));
  const store = await p.evaluate(() => JSON.stringify([...window.__store.entries()]));
  await mp.addInitScript({ content: fs.readFileSync(mockPath, "utf8") + `;for(const [k,v] of ${store}) window.__store.set(k,v);` });
  for (const r of ["central", "agenda", "instaladores"]) {
    await mp.goto("file://" + page + "#" + r); await mp.waitForTimeout(700);
    await shot(mp, "20-mobile-" + r, true);
    const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= 400, `no horizontal scroll on phone (${r}): ${sw}`);
  }
  await mp.click("#bottomNav [data-new]"); await mp.waitForTimeout(400); await shot(mp, "21-mobile-form");

  // installer view: emulate a contributor with a projection
  const inst = await b.newContext({ viewport: { width: 400, height: 860 }, userAgent: "Mozilla/5.0 (iPhone) Mobile" });
  const ip = await inst.newPage();
  ip.on("pageerror", e => errors.push("installer: " + e.message));
  const proj = await p.evaluate(() => { const c = window.App.getCtx(); const id = c.installers.find(i => i.nome === "Sony").id; const jobs = c.jobs.filter(j => (j._members || []).includes(id) && j.status !== "concluida"); return { papel: "instalador", instaladorId: id, nome: "Sony", cidade: "Manaus, AM, Brasil", obras: jobs.map(j => ({ id: j.id, cliente: j.cliente, tipo: j.tipo, status: j.status, itens: j.itens, servico: j.servico, agenda: { inicio: j.agenda.inicio, hora: j.agenda.hora }, fimPrevisto: window.Core.allocate(j, c).fim, dias: window.Core.allocate(j, c).blocks.map(b => ({ d: b.date, s: window.Core.fromMin(b.start), e: window.Core.fromMin(b.end) })), bairro: j.endereco.bairro, fone: "92991234567", endereco: j.endereco, obs: j.obs, prontidao: [] })) }; });
  await ip.addInitScript({ content: fs.readFileSync(mockPath, "utf8").replace("canEdit:true,isOwner:true", "canEdit:false,isOwner:false").replace("canEdit:()=>true", "canEdit:()=>false") + `;window.__store.set('acesso/u_admin', ${JSON.stringify(proj)});` });
  await ip.goto("file://" + page); await ip.waitForTimeout(900);
  await shot(ip, "30-installer", true);
  assert(await ip.isVisible("text=Minha Agenda"), "installer lands on Minha Agenda");
  assert((await ip.textContent(".next-head .nm")) === "TERCILIA", "today's job is the main card");
  await ip.click("[data-fev=inicio]"); await ip.waitForTimeout(500);
  const ev = await ip.evaluate(() => (window.__store.get("campo/u_admin") || {}).eventos || []);
  assert(ev.length === 1 && ev[0].tipo === "inicio", "check-in written to own field log");
  await shot(ip, "31-installer-started", true);

  console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
  await b.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); console.log(errors.join("\n")); process.exit(1); });
