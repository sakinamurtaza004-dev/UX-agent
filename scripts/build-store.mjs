// BUILD THE PACKAGE YOU UPLOAD TO THE CHROME WEB STORE.
//
//   node scripts/build-store.mjs --no-ai-server                 launch without the AI review
//   node scripts/build-store.mjs --server https://your.host     point the AI review at your hosted server
//   node scripts/build-store.mjs --dev                          keep the localhost default (for testing; do NOT upload)
//
// It copies only the files the extension needs (no server/, docs, tests or
// secrets), sets the default server address, checks the package for things the
// store would reject or that would be unsafe, and writes dist/<name>-<version>.zip.

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const fail = (m) => { console.error("\nBUILD STOPPED: " + m + "\n"); process.exit(1); };

// ---- 1. what is the default server address? ----
let serverUrl, label = "";
if (flag("--dev")) { serverUrl = "http://localhost:8787"; label = "-dev"; }
else if (flag("--no-ai-server")) serverUrl = "";
else if (value("--server")) {
  serverUrl = value("--server").replace(/\/+$/, "");
  let u; try { u = new URL(serverUrl); } catch { fail(`--server "${serverUrl}" is not a valid address.`); }
  if (u.protocol !== "https:") fail("--server must be an https address. Page text must never be sent over plain http.");
} else fail("Say how to build.\n  --no-ai-server        launch without the AI review\n  --server <https-url>  use your hosted review server\n  --dev                 local testing build (do not upload)");

// ---- 2. files that ship ----
const FILES = ["manifest.json", "panel.html", "panel.js", "panel.css", "report.html", "report.js", "report.css", "history.html", "history.js", "history.css"];
const DIRS = ["background", "content", "knowledge", "lib", "icons", "fonts"];
const list = [...FILES];
for (const d of DIRS) for (const f of fs.readdirSync(path.join(root, d))) if (/\.(js|png|css|html|woff2|txt)$/.test(f)) list.push(`${d}/${f}`);

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const staged = new Map(list.map((f) => [f, fs.readFileSync(path.join(root, f))]));

// default server address
const cfg = staged.get("lib/config.js").toString("utf8");
const newCfg = cfg.replace(/defaultServerUrl:\s*"[^"]*"/, `defaultServerUrl: ${JSON.stringify(serverUrl)}`);
if (newCfg === cfg && !cfg.includes(JSON.stringify(serverUrl))) fail("Couldn't set the default server address in lib/config.js.");
staged.set("lib/config.js", Buffer.from(newCfg));

// ---- 3. checks ----
const errors = [], warnings = [];
const m = JSON.parse(read("manifest.json"));
if (m.manifest_version !== 3) errors.push("manifest_version must be 3.");
if (!m.name || m.name.length > 45) errors.push("name is missing or longer than 45 characters.");
if (!m.description || m.description.length > 132) errors.push(`description must be 1-132 characters (now ${m.description ? m.description.length : 0}).`);
if (!/^\d+(\.\d+){0,3}$/.test(m.version || "")) errors.push("version must look like 1.2.3.");
const ALLOWED = ["activeTab", "scripting", "storage", "sidePanel"];
for (const p of m.permissions || []) if (!ALLOWED.includes(p)) errors.push(`Unexpected permission "${p}". Every permission must be justified in docs/store/permissions-and-disclosures.md, so add it there and to ALLOWED in this script on purpose.`);
// Site access is requested one site at a time, only when the user asks; nothing is granted at install.
const OPTIONAL_HOSTS = ["https://*/*", "http://*/*"];
for (const h of m.optional_host_permissions || []) if (!OPTIONAL_HOSTS.includes(h)) errors.push(`Unexpected optional host permission "${h}".`);
if (m.side_panel && !m.side_panel.default_path) errors.push("side_panel needs a default_path.");
if (m.action && m.action.default_popup) errors.push("action.default_popup is set, but the toolbar icon is meant to open the side panel.");
for (const k of ["host_permissions", "externally_connectable", "content_scripts", "web_accessible_resources", "update_url"]) if (m[k]) errors.push(`manifest has "${k}", which this extension shouldn't need. Remove it, or justify it in the docs.`);
for (const [size, f] of Object.entries(m.icons || {})) {
  const b = staged.get(f);
  if (!b) { errors.push(`icon ${f} is missing.`); continue; }
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (w !== Number(size) || h !== Number(size)) errors.push(`icon ${f} is ${w}x${h} but listed as ${size}.`);
}
if (!m.icons || !m.icons["128"]) errors.push("a 128x128 icon is required.");

// every file referenced from the manifest or an html page must be in the package
const need = new Set([m.action?.default_popup, m.side_panel?.default_path, m.background?.service_worker, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})].filter(Boolean));
for (const [f, buf] of staged) {
  const text = buf.toString("utf8");
  if (f.endsWith(".html")) {
    for (const mt of text.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
      if (/^https?:/.test(mt[1])) errors.push(`${f} loads a remote file (${mt[1]}). Manifest V3 forbids remotely hosted code.`);
      else if (!/\.html$/.test(mt[1])) need.add(mt[1]);
    }
  }
  if (/\.(js)$/.test(f)) {
    if (/\beval\s*\(/.test(text)) errors.push(`${f} uses eval(), which Manifest V3 forbids.`);
    if (/\bnew Function\s*\(/.test(text)) errors.push(`${f} uses new Function(), which Manifest V3 forbids.`);
    if (/importScripts\s*\(\s*["']https?:/.test(text)) errors.push(`${f} imports a remote script.`);
    if (/\.innerHTML\s*=|insertAdjacentHTML/.test(text)) warnings.push(`${f} writes HTML directly. Everything is meant to go in with textContent.`);
    if (/https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|lawsofux|www\.nngroup|www\.cppa|nda\.ie|www\.taylorwessing|www\.govinfo|www\.federalregister|guidelines\.india|www\.deque|www\.pib|ccpa\.doca|www\.springlex|www\.europarl|gibsondunn|www\.scconline|schemas|chatgpt\.com|claude\.ai|gemini\.google|copilot\.microsoft|www\.perplexity|your-ai\.example)/.test(text) && f !== "lib/config.js") {
      const hit = text.match(/https?:\/\/[^\s"'`)]+/g).filter((u) => !/localhost|127\.0\.0\.1|w3\.org|lawsofux|nngroup|cppa\.ca|nda\.ie|taylorwessing|govinfo|federalregister|india\.gov|deque|pib\.gov|doca\.gov|springlex|europarl|gibsondunn|scconline|chatgpt\.com|claude\.ai|gemini\.google|copilot\.microsoft|perplexity\.ai|example\.com/.test(u));
      if (hit.length) warnings.push(`${f} mentions other web addresses: ${[...new Set(hit)].slice(0, 3).join(", ")}`);
    }
  }
}
for (const [f, buf] of staged) {
  if (!f.endsWith(".css")) continue;
  for (const mt of buf.toString("utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (/^(https?:|data:)/.test(mt[1])) { if (/^https?:/.test(mt[1])) errors.push(`${f} loads a remote file (${mt[1]}).`); continue; }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), mt[1]));
    if (!staged.has(target)) errors.push(`${f} refers to ${target}, which is not in the package.`);
  }
}
for (const f of need) if (!staged.has(f)) errors.push(`${f} is referenced but not in the package.`);
if (/localhost|127\.0\.0\.1/.test(newCfg) && !flag("--dev")) errors.push("The store build still points at localhost.");
if (!flag("--dev") && newCfg.includes("http://")) errors.push("The default server address is not https.");
if (flag("--dev")) warnings.push("DEV build: points at localhost. Do not upload this to the store.");
// Reminders that are not build errors but must not be forgotten before submitting.
try {
  const policy = read("docs/privacy-policy.html");
  const open = (policy.match(/\[\[/g) || []).length;
  if (open) warnings.push(`docs/privacy-policy.html still has ${open} [[placeholder]] to fill in (and the yellow DRAFT box to delete) before you submit.`);
} catch { warnings.push("docs/privacy-policy.html is missing."); }

if (errors.length) fail("\n - " + errors.join("\n - "));

// ---- 4. write the zip ----
const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const zipName = `ux-audit-buddy-${m.version}${label}.zip`;
const zip = new AdmZip();
for (const [f, buf] of [...staged].sort(([a], [b]) => a.localeCompare(b))) zip.addFile(f, buf);
zip.writeZip(path.join(outDir, zipName));

const size = fs.statSync(path.join(outDir, zipName)).size;
console.log(`\nBuilt dist/${zipName}  (${(size / 1024).toFixed(0)} KB, ${staged.size} files)`);
console.log(`Version ${m.version} | permissions: ${(m.permissions || []).join(", ")} | AI server: ${serverUrl || "(none, AI review disabled)"}`);
for (const w of warnings) console.log("  note: " + w);
console.log("\nContents:\n  " + [...staged.keys()].sort().join("\n  "));
