# Agenda de obras — Mercatto Decor (v2)

Installation scheduling and workforce management for Mercatto Decor (Manaus, AM). The UI is in Brazilian Portuguese; code and docs are in English.

The app ships as **one self-contained HTML page** published as a claude.ai artifact. The artifact platform provides the shared database, per-path access rules, user identity, file uploads and downloads, so no separate server is needed.

## Layout

```
src/core.js          Pure scheduling core (no DOM): Manaus time, allocation, conflicts, availability,
                     duration estimates, recommendations, workload, alerts, suggestions, analytics,
                     roles/rules, migration, WhatsApp templates. Shared by the browser and the tests.
src/store.js         Data layer: claude.ai db (shared) or browser-only fallback (clearly labelled),
                     write tracking, field-event reconciliation, per-person projections, photo upload.
src/ui/app.js        Shell, routing, roles, job detail panel, job actions, alerts bell, projections.
src/ui/form.js       5-step job wizard (Cliente → Serviço → Agenda → Prontidão → Confirmação).
src/ui/views-ops.js  Central de Obras, Instalações/Manutenções, Agenda Semanal.
src/ui/views-team.js Instaladores, Desempenho, Configurações, Minha Agenda (installer), Quadro (viewer).
src/ui/styles.css    Design system from the Mercatto Decor Entregas app (Inter; Manrope on Obras pages; navy + gold palette).
src/ui/shell.html    Page skeleton; build.js inlines everything into dist/.
test/core.test.js    Scheduling tests (node:test).
test/e2e.js          Browser run (Playwright) against an in-memory db stand-in.
```

## Commands

```bash
node --test test/core.test.js      # 20 scheduling tests
node build.js                      # -> dist/agenda-de-obras.html + dist/capabilities.json
node test/e2e.js <mock.js> <legacy-jobs.json> <outDir>   # optional browser run
```

No npm dependencies. The e2e script needs Playwright with Chromium.

## Deploy

Publish `dist/agenda-de-obras.html` as a claude.ai artifact with the capabilities in `dist/capabilities.json`:

- `db` with the rules from `Core.DB_RULES` (enforced by the platform, not by the UI)
- `user` (scope `profile`)
- `downloads`
- `assets` (Contributors may upload completion photos)

Republishing to the same artifact keeps the data.

## Roles and data security

| Role | Share level in claude.ai | Can read | Can write |
|---|---|---|---|
| Administrador | Owner | everything | everything, including `cfg/*` (settings, access roster) |
| Coordenador | Editor | everything | jobs, installers, teams, alerts |
| Instalador | Contributor + roster entry linked to a profile | only `acesso/<own id>` (own agenda) and `campo/<own id>` | only `campo/<own id>` (check-in, pause, finish, problems, photos) |
| Visualizador | Viewer + roster entry | only `acesso/<own id>` (board without phones/full addresses) | nothing |

The platform enforces these rules:

```
{ path: "",              read: "admin",    write: "admin" }
{ path: "cfg",           read: "admin",    write: "owner" }
{ path: "acesso",        read: "admin",    write: "admin" }
{ path: "acesso/{self}", read: "view",     write: "admin" }
{ path: "campo",         read: "admin",    write: "admin" }
{ path: "campo/{self}",  read: "interact", write: "interact" }
```

Installers never receive other customers' records. An admin's open page writes a per-person *projection* (`acesso/<userId>`) with just that person's data. Admin pages then copy installer field events from `campo/*` into the jobs, idempotently by event id, using a short lease so two open admin tabs don't both apply them.

Platform constraint: share levels are hierarchical (view < interact < admin), so a viewer cannot see data that a contributor cannot. That is why viewers also get a projection instead of direct read access.

## Data model (collections)

- `obras/{id}` jobs, schema v2:
  - `tipo`, `status` (rascunho | aguardando | agendada | andamento | pausada | concluida | cancelada), `prio`
  - `cliente`, `fone`, `endereco{completo, bairro, ref, lat, lng}`, `itens[{mat, qtd, unidade, unidadeInferida}]`
  - `complexidade`, `servico`, `obs`, `equipeNecessaria`
  - `instaladorIds[]` or `equipeId` (a team is resolved live, so availability changes propagate)
  - `agenda{inicio, hora, horas, horasManual}`, `estimativa{horas, origem}`, `prontidao{material, cliente, local, medidas, ferramentas}`
  - `real{inicio, fim, pausas[]}`, `atividade[]` (activity log), `conclusao{notas, pendencias, fotos[]}`, `atrasoCausa`
  - `overrides[]` (accepted conflicts with reason), `hist[]` (audit trail), `manutencaoDe`, `retrabalho`, `criado`/`atualizado`/`atualizadoPor`
- `instaladores/{id}`: `nome`, `fone`, `ativo`, `materiais{mat: 1..5}`, `produtividade{mat: units/day}`, `fazManutencao`, `lider`, `semana` (own hours or null = company hours), `bloqueios[{tipo, de, ate, motivo}]`, `bairros`, `base{lat,lng}`
- `equipes/{id}`: `nome`, `membros[]`, `lider`
- `cfg/main` (company week, holidays, reference productivity, readiness rules, weights, travel buffer), `cfg/acessos`, `cfg/migracao`
- `alertas/estado` (dismissed alerts and suggestions), `backups/*`, `acesso/{userId}`, `campo/{userId}`

Derived states are computed, never stored as statuses: Atrasada, Inicia hoje, Termina hoje, Sem instalador, Conflito, readiness.

## Scheduling rules

- **Time zone.** All business dates use America/Manaus via `Intl` (`Core.today()`, `Core.tsParts()`). Date arithmetic works on calendar dates in UTC, never in the browser's time zone.
- **Allocation.** A job's working hours are laid on the company calendar (holidays excluded); a lunch break is added to blocks over 4 h. Each installer's own calendar, day off, vacation and hours are then checked by `validateJob`, the single validator used by every screen. It reports overlaps, insufficient travel buffer, days off, unavailability, out-of-hours work, inactive installers, missing expertise, staffing and readiness.
- **Duration estimates.** Productivity comes from real history first (at least 2 jobs), then the profile, then the reference table, which is labelled "referência" in the UI. With no quantity, no estimate is invented.
- **Recommendations.**
  - Mandatory filters run first: active, every material, maintenance capability, available for the whole period, staffing.
  - Then a weighted score: expertise 35, availability 30 (with a small workload-balancing share), proximity 15, productivity 10, history 10.
  - Factors without data are dropped and their weight redistributed; a confidence level is shown.
  - Ties break by date, then name, then id, so results are deterministic.

## Migration (v1 → v2)

`Core.planMigration()` is pure and idempotent. Run from Configurações (owner only), or applied once by Claude, it:

1. writes a full backup of the legacy records to `backups/<timestamp>-<n>`;
2. creates installer profiles from the free-text names. Names that differ only in case, accents or spacing are the same person; "A E B" / "A + B" become a team; nothing else is merged;
3. rewrites each job in place under the same id: materials parsed into catalog items (unknown ones kept as "Outro" with the original text), quantities parsed (unit marked "a confirmar" when it was missing), start/end dates converted into planned hours;
4. gives installers rating 3 on materials they actually executed;
5. writes `cfg/migracao`.

Before migration, legacy records are shown read-only as a preview.

## External integrations not configured

| Need | Status | What it needs |
|---|---|---|
| Street map tiles, address geocoding, driving times | Not included: the in-app map was removed on request, and the artifact sandbox blocks third-party map/geocoding requests. Optional coordinates (pasted Google Maps link or "lat, lng") are only used for straight-line proximity in recommendations; "Google Maps"/"Navegar" buttons open the address externally. | A maps provider behind a server-side proxy holding the API key; plug into `Core.parseCoords`/`referencePoint`. |
| Device location for check-in | Not available to artifact pages in this account (no location capability). Check-ins record time only and the UI says so; nothing is shown as a live location. | A location capability or a native wrapper; then add coordinates to the field event. |
| Automatic WhatsApp messages | Only `wa.me` deep links with prefilled text; the app never claims a message was sent. | WhatsApp Business API provider, server-side. |
| Offline queue | The platform caches and replays reads; the UI shows pending/unsynced writes and offline state. There is no custom offline write queue. | A service worker (not available inside artifacts). |
