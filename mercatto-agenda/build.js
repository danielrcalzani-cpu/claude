/* Build: inline all sources into one self-contained page (dist/agenda-de-obras.html). Run: node build.js */
"use strict";
const fs = require("fs"), path = require("path");
const r = p => fs.readFileSync(path.join(__dirname, p), "utf8");
const icons = JSON.parse(r("src/ui/icons.json"));
const sprite = Object.entries(icons).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("");
const parts = { CSS: r("src/ui/styles.css"), SPRITE: sprite, CORE: r("src/core.js"), STORE: r("src/store.js"), APP: r("src/ui/app.js"), FORM: r("src/ui/form.js"), OPS: r("src/ui/views-ops.js"), TEAM: r("src/ui/views-team.js") };
let html = r("src/ui/shell.html");
for (const [k, v] of Object.entries(parts)) {
  if (/<\/script/i.test(v)) throw new Error(`${k} contains a closing script tag`);
  html = html.replace(`/*${k}*/`, () => v);
}
// Every icon referenced in the code must exist in the sprite.
const used = new Set([...html.matchAll(/ic\("([a-z0-9-]+)"/g), ...html.matchAll(/#i-([a-z0-9-]+)/g), ...html.matchAll(/icon: "([a-z0-9-]+)"/g)].map(m => m[1]));
const missing = [...used].filter(n => !icons[n]);
if (missing.length) throw new Error("Missing icons: " + missing.join(", "));
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist/agenda-de-obras.html"), html);
// Capabilities the page must be published with (rules are enforced by the platform).
const caps = { db: { rules: require("./src/core.js").DB_RULES }, user: { scopes: ["profile"] }, downloads: true, assets: { upload: "interact" } };
fs.writeFileSync(path.join(__dirname, "dist/capabilities.json"), JSON.stringify(caps, null, 2));
console.log(`dist/agenda-de-obras.html ${(html.length / 1024).toFixed(0)} KB, ${Object.keys(icons).length} icons`);
