// SIDE PANEL: the whole UX Audit Buddy interface.
//
// Everything on screen is drawn from ONE thing, a saved-audit record (see
// lib/audit-model.js). A fresh scan builds a record and shows it; opening an
// old audit from History loads a record the same way. That keeps live and saved
// views identical.
//
// SECURITY: text from audited sites and from the AI is only ever put on the
// page with textContent (via el()), never innerHTML.

const $ = (id) => document.getElementById(id);
const VERSION = chrome.runtime.getManifest().version;

// ---------------------------------------------------------------- state
const App = {
  screen: "start",     // start | scan | done | blocked | needaccess | error
  tab: "overview",     // overview | issues | laws | rules | ai
  rec: null,           // the record being shown
  cur: null,           // live scan data (result, laws, ai...) or null for a saved audit
  live: false,         // true = made by a scan in this panel (page text, Show on page available)
  tabId: null,         // browser tab the live scan came from
  target: null,        // { id, title, url } of the active tab (best effort)
  stale: false,        // the user moved on from the scanned page
  fail: null,
  recents: [],
  settings: { serverUrl: APP_CONFIG.defaultServerUrl, token: "", consent: false, screenshot: true },
  ui: {
    scanStep: 0, filter: "all", issueOpen: {}, passOpen: false, lawGroup: { not: true }, lawOpen: {}, ruleGroup: { may: true }, ruleOpen: {},
    sheet: null, histList: [], saveHist: true, editServer: false, confirmClear: false,
    aiStatus: "idle", aiErr: "", aiOut: null, aiMsg: "",
  },
};
let chatNode = null;            // the chat card keeps what the user typed, so it is built once
let lastFocusKey = null;
let toastTimer = null;

function set(patch, { reset = false } = {}) {
  Object.assign(App, patch);
  render({ resetScroll: reset });
}
function ui(patch) { Object.assign(App.ui, patch); render(); }

function toast(text, isErr = false) {
  const w = $("toastw");
  w.replaceChildren();
  if (!text) return;
  w.append(el("div", { class: "toast" + (isErr ? " err" : "") }, icon("check", 14, "#fff", 2.4), document.createTextNode(text)));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => w.replaceChildren(), 2600);
}

const openTab = (page) => chrome.tabs.create({ url: chrome.runtime.getURL(page) });

// ---------------------------------------------------------------- small pieces
const pill = (cls, text) => el("span", { class: "pill " + cls, text });
const fk = (key, node) => { node.dataset.fk = key; return node; };
function chev(open) { const s = icon("chevDown", 14, "currentColor", 2); s.classList.add("chev"); if (open) s.classList.add("up"); return s; }
const card = (props, ...kids) => el("div", Object.assign({ class: "card" }, props), ...kids);
const cap = (t) => el("div", { class: "cap", text: t });
const kvRow = (label, value) => [el("span", { text: label }), typeof value === "string" ? el("span", { text: value }) : el("span", {}, value)];
function kv(rows) {
  const g = el("div", { class: "kv" });
  rows.filter(Boolean).forEach(([l, v]) => kvRow(l, v).forEach((n) => g.append(n)));
  return g;
}
const bulletList = (items) => { const u = el("ul"); items.forEach((t) => u.append(el("li", { text: t }))); return u; };

// A row that opens and closes (issues, laws, rules).
function accRow(key, open, onToggle, ...kids) {
  const b = el("button", { type: "button", class: "row", "aria-expanded": String(open) }, ...kids, chev(open));
  b.addEventListener("click", onToggle);
  return fk(key, b);
}

// ---------------------------------------------------------------- header
function pageIdentity() {
  if (App.screen === "done" && App.rec) return { title: App.rec.title || "(untitled page)", sub: pageSub(App.rec), letter: letterOf(App.rec.url) };
  const t = App.target;
  if (t && t.url) return { title: t.title || "Current page", sub: hostOf(t.url), letter: letterOf(t.url) };
  return { title: "Current page", sub: "Click the toolbar icon on a website to read it", letter: "?" };
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
function letterOf(u) { const h = hostOf(u); return h ? h[0].toUpperCase() : "?"; }

function buildHeader() {
  const hd = el("div", { class: "hd" });
  const hist = fk("hist", el("button", { type: "button", class: "ib", "aria-label": "History" }, icon("history", 18)));
  const setb = fk("set", el("button", { type: "button", class: "ib", "aria-label": "Settings" }, icon("settings", 18)));
  hist.addEventListener("click", () => openSheet("hist"));
  setb.addEventListener("click", () => openSheet("set"));
  hd.append(el("div", { class: "hrow" },
    el("div", { class: "logo" }, icon("logo", 15, "#fff", 2.4)),
    el("div", { class: "brand", text: "UX Audit Buddy" }), hist, setb));

  const id = pageIdentity();
  const pg = el("div", { class: "pg" }, el("div", { class: "fav", text: id.letter }),
    el("div", { style: "min-width:0;flex:1" }, el("div", { class: "pgt", text: id.title }), el("div", { class: "pgu", text: id.sub })));
  if (App.screen === "done") {
    const rs = fk("rescan", el("button", { type: "button", class: "ib", "aria-label": "Scan the current page again" }, icon("rescan", 16, "currentColor", 1.9)));
    rs.addEventListener("click", scan);
    pg.append(rs);
  }
  hd.append(pg);

  if (App.screen === "done") {
    const issues = App.rec ? failedChecks(App.rec).length : 0;
    const defs = [["overview", "Overview", 0], ["issues", "Issues", issues], ["laws", "UX laws", 0], ["rules", "Rules", 0], ["ai", "AI review", 0]];
    const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "Audit sections" });
    defs.forEach(([k, label, cnt]) => {
      const on = App.tab === k;
      const b = el("button", { type: "button", role: "tab", id: "tab-" + k, class: on ? "tab on" : "tab", "aria-selected": String(on), "aria-controls": "tabpanel", tabindex: on ? "0" : "-1" }, document.createTextNode(label));
      if (cnt > 0) b.append(el("span", { class: "cnt", text: String(cnt) }));
      b.addEventListener("click", () => goTab(k));
      b.addEventListener("keydown", (e) => {
        const keys = defs.map((d) => d[0]);
        let i = keys.indexOf(k);
        if (e.key === "ArrowRight") i = (i + 1) % keys.length;
        else if (e.key === "ArrowLeft") i = (i - 1 + keys.length) % keys.length;
        else if (e.key === "Home") i = 0;
        else if (e.key === "End") i = keys.length - 1;
        else return;
        e.preventDefault();
        lastFocusKey = "tab-" + keys[i];
        goTab(keys[i]);
      });
      b.dataset.fk = "tab-" + k;
      tabs.append(b);
    });
    hd.append(tabs);
  }
  return hd;
}

function goTab(t) { set({ tab: t }, { reset: true }); }

// While the "needs your OK" screen is showing, notice when the user has clicked the toolbar icon
// (Chrome then reveals the page's address) and carry on with the scan by itself.
let accessTimer = null;
function watchForAccess() {
  clearInterval(accessTimer);
  accessTimer = setInterval(async () => {
    if (App.screen !== "needaccess" || App.ui.retrying) return;
    await refreshTarget();
    if (App.target && /^https?:/i.test(App.target.url || "")) { clearInterval(accessTimer); toast("Access granted. Scanning…"); scan(); }
  }, 800);
}
document.addEventListener("visibilitychange", async () => { if (!document.hidden) { await refreshTarget(); if (App.screen === "start") render(); } });

// ---------------------------------------------------------------- start / scanning / problems
function buildStart() {
  const frag = el("div", {});
  const canScan = !(App.target && App.target.url && !/^https?:/i.test(App.target.url));
  const go = el("button", { type: "button", class: "btn pri big", text: "Scan this page" });
  go.disabled = !canScan;
  go.addEventListener("click", scan);
  frag.append(card({ style: "padding:18px 16px" },
    el("div", { class: "h2", style: "font-size:16px;margin-bottom:4px", text: "Audit this page" }),
    el("p", { class: "mut sm", style: "margin:0 0 14px", text: "Checks accessibility, UX laws, trust and the rules that may apply, in a few seconds." }),
    go,
    canScan ? null : el("p", { class: "err", style: "margin:8px 0 0", text: "Chrome doesn't allow audits on this kind of page. Open a website first." }),
    el("div", { class: "xs", style: "display:flex;gap:6px;align-items:center;margin-top:10px" }, icon("lock", 13, "#067647", 2), document.createTextNode("Runs on this device. Nothing is sent anywhere."))));

  frag.append(cap("What it checks"));
  const items = [
    [String(UX_CHECK_COUNT), "Accessibility, mobile, speed and trust", "Contrast, labels, tap targets, dark patterns"],
    [String(UX_LAW_COUNT), "UX laws and heuristics", "Hick's, Fitts's, Jakob's, all 10 Nielsen heuristics and more"],
    [String(Object.keys(REGS).length), "Rules that may apply", "India, EU and US accessibility and consumer law"],
  ];
  const l = el("div", { class: "list" });
  items.forEach(([n, t, s]) => l.append(el("div", { class: "it", style: "display:flex;gap:10px;padding:11px 12px" },
    el("div", { style: "width:30px;height:30px;border-radius:8px;background:#EEF0FF;display:flex;align-items:center;justify-content:center;flex:none;color:#4F46E5;font-weight:700;font-size:12px", text: n }),
    el("div", {}, el("div", { style: "font-weight:600;font-size:13px", text: t }), el("div", { class: "xs", text: s })))));
  frag.append(l);

  frag.append(cap("Recent audits"));
  if (!App.recents.length) frag.append(card({ class: "card xs", style: "text-align:center;padding:16px" }, document.createTextNode("No audits yet on this device. Each scan is saved here.")));
  else {
    const rl = el("div", { class: "list" });
    App.recents.slice(0, 3).forEach((e) => rl.append(recentRow(e)));
    frag.append(rl);
  }
  return frag;
}

function recentRow(e) {
  const b = fk("recent-" + e.id, el("button", { type: "button", class: "recent" },
    el("div", { class: "fav", text: letterOf(e.url) }),
    el("span", { class: "rt" }, el("span", { style: "display:block;font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: `${hostOf(e.url)}` }),
      el("span", { class: "xs", text: `${timeAgo(e.ts)} · ${e.failed} issue${e.failed === 1 ? "" : "s"}` })),
    el("span", { class: "sc", style: "color:" + scoreInk(e.score), text: String(e.score) })));
  b.addEventListener("click", () => openSaved(e.id));
  return b;
}

const SCAN_STEPS = ["Accessibility and readability", "Performance and mobile", "UX laws and heuristics", "Trust, dark patterns and rules"];
function buildScanning() {
  const frag = el("div", {});
  const c = card({ style: "padding:18px 16px" },
    el("div", { class: "h2", style: "font-size:16px;margin-bottom:2px", text: "Scanning this page" }),
    el("p", { class: "xs", style: "margin:0 0 10px", text: `${UX_CHECK_COUNT} checks, ${UX_LAW_COUNT} UX laws and ${Object.keys(REGS).length} regulations` }));
  SCAN_STEPS.forEach((t, i) => {
    const done = App.ui.scanStep > i, run = App.ui.scanStep === i;
    const dot = el("div", { class: "dot " + (done ? "d-done" : run ? "d-run" : "d-wait") });
    if (done) dot.append(icon("check", 11, "#fff", 3.5));
    c.append(el("div", { class: "step" }, dot, el("div", { style: "flex:1;color:" + (done || run ? "#101828" : "#667085"), text: t }), el("div", { class: "xs", text: done ? "Done" : run ? "Checking" : "" })));
  });
  frag.append(c, card({ class: "card xs", style: "padding:12px 14px" }, document.createTextNode("Tip: keep this panel open while you browse. Every page you scan is saved to History.")));
  return frag;
}

function buildProblem() {
  const f = App.fail || {};
  if (App.screen === "blocked") {
    return card({ style: "padding:18px 16px" },
      el("div", { class: "h2", style: "font-size:16px", text: "Chrome doesn't allow audits here" }),
      el("p", { class: "mut sm", style: "margin:0 0 12px", text: "Browser pages (like chrome://) and the Chrome Web Store are off limits to every extension. Open a normal website and scan it." }),
      (() => { const b = el("button", { type: "button", class: "btn pri", text: "Back" }); b.addEventListener("click", () => set({ screen: "start", fail: null })); return b; })());
  }
  if (App.screen === "needaccess") {
    const c = card({ style: "padding:18px 16px" },
      el("div", { class: "h2", style: "font-size:16px", text: "Chrome needs your OK to read this page" }),
      el("p", { class: "mut sm", style: "margin:0 0 8px", text: "To keep your browsing private, this extension only reads a page when you ask it to." }),
      el("ol", { class: "sm mut", style: "margin:0 0 12px;padding-left:18px" },
        el("li", { text: "Click the UX Audit Buddy icon in the toolbar, with this page showing. The panel stays open." }),
        el("li", { text: "The scan then starts by itself. If it doesn't, press Scan again." })));
    if ((f.attempts || 0) > 0) c.append(el("div", { class: "err", role: "alert", style: "margin:0 0 10px", text: "Still can't read this page. Click the toolbar icon while this tab is showing, then try again." }));
    c.append(el("p", { class: "xs", style: "margin:0 0 12px", text: "Browser pages (like chrome://) and the Chrome Web Store are never allowed, for any extension. Open a normal website instead." }));
    const row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
    const again = fk("scan-again", el("button", { type: "button", class: "btn pri", text: App.ui.retrying ? "Checking…" : "Scan again" }));
    again.disabled = !!App.ui.retrying;
    again.addEventListener("click", scan);
    row.append(again);
    if (f.origin) {
      const allow = el("button", { type: "button", class: "btn", text: "Allow on " + hostOf(f.origin) });
      allow.addEventListener("click", () => allowSite(f.origin));
      row.append(allow);
    }
    c.append(row);
    return c;
  }
  return card({ style: "padding:18px 16px" },
    el("div", { class: "h2", style: "font-size:16px", text: "The scan didn't finish" }),
    el("p", { class: "mut sm", style: "margin:0 0 12px", text: "Something went wrong while reading this page. Try again, or reload the page first." }),
    (() => { const b = el("button", { type: "button", class: "btn pri", text: "Try again" }); b.addEventListener("click", scan); return b; })());
}

// ---------------------------------------------------------------- overview
function ring(score) {
  const r = 38, C = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "88"); svg.setAttribute("height", "88"); svg.setAttribute("viewBox", "0 0 88 88"); svg.setAttribute("aria-hidden", "true");
  const mk = (stroke, off) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "44"); c.setAttribute("cy", "44"); c.setAttribute("r", String(r)); c.setAttribute("fill", "none");
    c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", "8"); c.setAttribute("stroke-linecap", "round");
    if (off !== null) { c.setAttribute("stroke-dasharray", String(C)); c.setAttribute("stroke-dashoffset", String(off)); }
    return c;
  };
  svg.append(mk("#F2F4F7", null), mk(scoreFill(score), C * (1 - score / 100)));
  return el("div", { class: "ring" }, svg, el("div", { class: "rv" }, el("div", { style: "font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1", text: String(score) }), el("div", { class: "xs", text: "of 100" })));
}

function buildOverview() {
  const rec = App.rec, frag = el("div", {});
  const v = scoreVerdict(rec.score), failed = failedChecks(rec), passed = passedChecks(rec);

  const sc = card({},
    el("div", { style: "display:flex;gap:14px;align-items:center" }, ring(rec.score),
      el("div", { style: "min-width:0" },
        el("div", { style: "font-size:15px;font-weight:700;color:" + v.ink, text: v.label }),
        el("p", { class: "sm mut", style: "margin:2px 0 8px", text: weakSentence(rec) }),
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, pill(failed.length ? "p-high" : "p-ok", `${failed.length} issue${failed.length === 1 ? "" : "s"}`), pill("p-ok", `${passed.length} passed`)))));
  const prev = App.live && App.cur && App.cur.prev && App.cur.saveResult && App.cur.saveResult.history ? App.cur.prev : null;
  if (prev) {
    const c = compareAudits(prev, rec), cls = c.delta > 0 ? "up" : c.delta < 0 ? "dn" : "";
    sc.append(el("div", { class: "cmpline" }, document.createTextNode(`Since your audit on ${new Date(prev.ts).toLocaleDateString()}: `),
      el("b", { class: cls, text: `${c.scoreFrom} → ${c.scoreTo} (${c.delta > 0 ? "+" : ""}${c.delta})` }),
      document.createTextNode(` · ${c.fixed.length} fixed · ${c.regressed.length} new. `),
      (() => { const b = el("button", { type: "button", class: "lnk", text: "Compare" }); b.addEventListener("click", () => openTab(`history.html?compare=${prev.id},${rec.id}`)); return b; })()));
  }
  frag.append(sc);

  // Fix these first
  const fx = card({});
  const head = el("div", { style: "display:flex;align-items:center;margin-bottom:4px" }, el("div", { class: "h2", style: "flex:1;margin:0", text: "Fix these first" }));
  if (failed.length) { const all = el("button", { type: "button", class: "lnk", text: `All ${failed.length} issue${failed.length === 1 ? "" : "s"}` }); all.addEventListener("click", () => goTab("issues")); head.append(all); }
  fx.append(head);
  if (!failed.length) fx.append(el("p", { class: "sm mut", style: "margin:4px 0 0", text: "Nothing to fix: every automatic check passed." }));
  topFixes(rec).forEach((c) => {
    const b = fk("fix-" + c.id, el("button", { type: "button", class: "fixr" }, pill(SEV_PILL[c.severity], SEV_LABEL[c.severity]), el("span", { class: "ft", style: "flex:1", text: c.title }), el("span", { class: "num", text: String(c.count) }), icon("chevRight", 14, "#667085", 2)));
    b.addEventListener("click", () => { App.ui.issueOpen = { [c.id]: true }; App.ui.filter = "all"; goTab("issues"); });
    fx.append(b);
  });
  frag.append(fx);

  // Score by area
  const { bars, perfect } = areaBars(rec);
  const ar = card({}, el("div", { class: "h2", text: "Score by area" }));
  bars.forEach(([n, val]) => {
    const fill = el("i"); fill.style.width = val + "%"; fill.style.background = scoreFill(val);
    ar.append(el("div", { class: "cat" }, el("span", { class: "cn", text: n }), el("span", { class: "bar" }, fill), el("span", { class: "cv", style: "color:" + scoreInk(val), text: String(val) })));
  });
  if (perfect.length) ar.append(el("div", { class: "xs", style: "display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid #F2F4F7" }, icon("check", 13, "#067647", 2.4), document.createTextNode(`${joinNames(perfect)}: all 100`)));
  frag.append(ar);

  // Tiles
  const lc = lawCounts(rec), may = mayApplyCount(rec);
  const tile = (cls, labelText, value, valueInk, unit, sub, go, key) => { const b = fk(key, el("button", { type: "button", class: "tile" }, el("div", { class: "xs", text: labelText }), el("div", { class: "tv", style: "color:" + valueInk }, document.createTextNode(value + " "), el("span", { style: "font-size:12px;font-weight:500;color:#475467", text: unit })), el("div", { class: "xs", text: sub }))); b.addEventListener("click", go); return b; };
  frag.append(el("div", { style: "display:flex;gap:10px;margin-bottom:12px" },
    tile("", "UX laws", String(lc.not), lc.not ? "#B42318" : "#067647", "not followed", `${lc.followed} followed · ${lc.partly} partly`, () => goTab("laws"), "tile-laws"),
    tile("", "Rules", String(may), may ? "#B54708" : "#475467", "may apply", (ruleBasis(rec)[0] || "").startsWith("No region") ? "No region signals found" : "Based on " + ruleBasis(rec)[0], () => goTab("rules"), "tile-rules")));

  // AI
  const ai = fk("go-ai", el("button", { type: "button", class: "card", style: "width:100%;text-align:left;display:flex;gap:12px;align-items:center;border-color:#C7D2FE;background:#FAFAFF" },
    el("div", { style: "width:34px;height:34px;border-radius:9px;background:#EEF0FF;display:flex;align-items:center;justify-content:center;flex:none" }, icon("chat", 17, "#4F46E5", 1.9)),
    el("div", { style: "flex:1" }, el("div", { style: "font-weight:600;font-size:13px;color:#101828", text: "Go deeper with AI" }), el("div", { class: "xs", text: `USP, what works, and the ${lc.unmeasured + lc.ai} laws code can't judge` })),
    icon("chevRight", 16, "#667085", 2)));
  ai.addEventListener("click", () => goTab("ai"));
  frag.append(ai);

  // Report
  const rep = el("button", { type: "button", class: "btn", style: "flex:1", text: "Open full report" });
  rep.addEventListener("click", openReport);
  const saved = App.live ? (App.cur && App.cur.saveResult ? (App.cur.saveResult.ok ? (App.cur.saveResult.history ? "Saved to history" : "Not saved (history off)") : "Couldn't save") : "Saving…") : "Saved audit";
  frag.append(el("div", { style: "display:flex;gap:8px;align-items:center" }, rep, el("div", { class: "xs", style: "display:flex;gap:5px;align-items:center" }, icon("check", 13, "#067647", 2.4), document.createTextNode(saved))));
  return frag;
}

function openReport() {
  const id = App.live && App.cur && App.cur.saveResult && !App.cur.saveResult.history ? "last" : App.rec.id;
  openTab(`report.html?id=${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------- issues
function buildIssues() {
  const rec = App.rec, frag = el("div", {});
  const failed = failedChecks(rec), passed = passedChecks(rec);
  const count = (s) => failed.filter((c) => s === "all" || c.severity === s).length;
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Filter by severity" });
  [["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].forEach(([k, l]) => {
    const on = App.ui.filter === k;
    const b = fk("flt-" + k, el("button", { type: "button", class: on ? "sg on" : "sg", "aria-pressed": String(on), text: `${l} ${count(k)}` }));
    b.addEventListener("click", () => ui({ filter: k }));
    seg.append(b);
  });
  frag.append(seg);

  if (!App.live && failed.length) frag.append(el("p", { class: "xs", style: "margin:0 0 10px", text: "This is a saved audit. Scan the page again to highlight problems on it." }));
  const shown = failed.filter((c) => App.ui.filter === "all" || c.severity === App.ui.filter);
  if (!failed.length) frag.append(card({}, el("div", { class: "sm", text: "No issues found by the automatic checks. Nice work!" })));
  else if (!shown.length) frag.append(card({ class: "card xs" }, document.createTextNode("No issues at this severity.")));
  const list = el("div", { class: "list" });
  const hl = {};
  if (App.live && App.cur) App.cur.result.checks.forEach((c) => { hl[c.id] = c.highlightable || 0; });
  shown.forEach((c) => {
    const open = !!App.ui.issueOpen[c.id];
    const it = el("div", { class: "it" }, accRow("iss-" + c.id, open, () => { App.ui.issueOpen = { ...App.ui.issueOpen, [c.id]: !open }; render(); },
      pill(SEV_PILL[c.severity], SEV_LABEL[c.severity]), el("span", { class: "rt", text: c.title }), el("span", { class: "num", text: String(c.count) })));
    if (open) {
      const laws = c.uxLawIds.map((id) => rec.laws.find((l) => l.id === id)).filter(Boolean);
      const det = el("div", { class: "det" }, kv([
        ["Found", `${c.count} on this page` + (c.examples.length ? `: ${c.examples.slice(0, 2).join(" | ")}` : "")],
        ["Why", c.why],
        ["Fix", c.fix],
        ["Standard", c.wcag.length ? c.wcag.map((w) => w.name).join("; ") : c.ref],
        laws.length ? ["UX laws", (() => { const d = el("div", {}); laws.forEach((l) => d.append(el("div", { style: "display:flex;gap:6px;align-items:center;margin-bottom:3px" }, pill(LAW_VERDICT_PILL[l.verdict][1], LAW_VERDICT_PILL[l.verdict][0]), document.createTextNode(shortLawName(l.name))))); return d; })()] : null,
        c.context ? ["Note", c.context] : null,
      ]));
      const btns = el("div", { style: "display:flex;gap:8px" });
      if (App.live && hl[c.id] > 0) {
        const show = el("button", { type: "button", class: "btn sm2 pri", text: "Show on page" });
        show.addEventListener("click", () => showOnPage(c));
        btns.append(show);
      }
      const copy = el("button", { type: "button", class: "btn sm2", text: "Copy fix" });
      copy.addEventListener("click", async () => { const r = await copyText(c.fix); toast(r === "failed" ? "Couldn't copy. Select the text instead." : "Fix copied", r === "failed"); });
      btns.append(copy);
      det.append(btns);
      it.append(det);
    }
    list.append(it);
  });
  if (shown.length) frag.append(list);

  const open = App.ui.passOpen;
  const gh = fk("pass", el("button", { type: "button", class: "gh", "aria-expanded": String(open) }, icon("check", 14, "#067647", 2.4), el("span", { style: "flex:1", text: `Done right (${passed.length})` }), chev(open)));
  gh.addEventListener("click", () => ui({ passOpen: !open }));
  frag.append(gh);
  if (open) {
    const l = el("div", { class: "list", style: "padding:6px 0" });
    passed.forEach((c) => l.append(el("div", { class: "ok" }, icon("check", 13, "#067647", 2.4), el("span", { text: c.title }))));
    frag.append(l);
  }
  return frag;
}

async function showOnPage(c) {
  if (!App.tabId) { toast("Scan the page again to highlight problems.", true); return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: App.tabId }, files: ["content/highlight.js"] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: App.tabId }, func: (id) => (window.__uxabHighlight ? window.__uxabHighlight(id) : null), args: [c.id] });
    if (!result || result.shown === 0) toast("Those elements aren't on the page any more. Scan again.", true);
    else toast(`Highlighting ${result.shown} on the page` + (result.total > result.shown ? ` (of ${result.total})` : "") + ". Press Esc on the page to clear.");
  } catch (e) {
    toast("Couldn't reach that page. Click the toolbar icon on it, then try again.", true);
  }
}

// ---------------------------------------------------------------- UX laws
function buildLaws() {
  const rec = App.rec, frag = el("div", {});
  const lc = lawCounts(rec);
  const judged = lc.followed + lc.partly + lc.not;
  const head = lc.ai ? `${judged + lc.ai} judged · ${judged} by code, ${lc.ai} by AI` : `${lc.followed} followed · ${lc.partly} partly · ${lc.not} not followed`;
  const seg = (n, bg) => (n ? el("span", { style: `flex:${n};background:${bg}` }) : null);
  const stk = el("div", { class: "stk", role: "img", "aria-label": head }, seg(lc.followed, "#17B26A"), seg(lc.partly, "#F79009"), seg(lc.not, "#F04438"), seg(lc.na, "#D0D5DD"), seg(lc.ai, "#6172F3"), seg(lc.unmeasured, "#C7D2FE"));
  const leg = el("div", { class: "leg" });
  [["#17B26A", `${lc.followed} followed`, lc.followed], ["#F79009", `${lc.partly} partly`, lc.partly], ["#F04438", `${lc.not} not followed`, lc.not], ["#D0D5DD", `${lc.na} can't judge`, lc.na], ["#6172F3", `${lc.ai} judged by AI`, lc.ai], ["#C7D2FE", `${lc.unmeasured} need AI review`, lc.unmeasured]]
    .filter((x) => x[2]).forEach(([c, t]) => leg.append(el("span", {}, (() => { const i = el("i"); i.style.background = c; return i; })(), document.createTextNode(t))));
  frag.append(card({}, el("div", { style: "font-size:14px;font-weight:600", text: head }), stk, leg));

  groupLaws(rec).forEach((g) => {
    const open = g.key in App.ui.lawGroup ? App.ui.lawGroup[g.key] : g.open;
    const gh = fk("lg-" + g.key, el("button", { type: "button", class: "gh", "aria-expanded": String(open) }, pill(g.pill, g.label), el("span", { style: "flex:1;color:#667085;font-weight:500", text: String(g.items.length) }), chev(open)));
    gh.addEventListener("click", () => { App.ui.lawGroup = { ...App.ui.lawGroup, [g.key]: !open }; render(); });
    frag.append(gh);
    if (!open) return;
    if (g.review) {
      const c = card({ style: "background:#FAFAFF;border-color:#C7D2FE" },
        el("p", { class: "sm", style: "margin:0 0 8px;color:#344054", text: "Code can't measure these. An AI review looks at the page and judges them for you." }),
        el("p", { class: "xs", style: "margin:0 0 10px", text: g.items.map((l) => shortLawName(l.name)).join(" · ") }));
      const b = el("button", { type: "button", class: "btn pri sm2", text: "Run AI review" }); b.addEventListener("click", () => goTab("ai")); c.append(b);
      frag.append(c);
      return;
    }
    const list = el("div", { class: "list" });
    g.items.forEach((l) => {
      const o = !!App.ui.lawOpen[l.id];
      const it = el("div", { class: "it" }, accRow("law-" + l.id, o, () => { App.ui.lawOpen = { ...App.ui.lawOpen, [l.id]: !o }; render(); },
        el("span", { class: "rt", text: shortLawName(l.name) }), g.ai ? pill(LAW_VERDICT_PILL[l.verdict][1], LAW_VERDICT_PILL[l.verdict][0]) : null));
      if (o) {
        it.append(el("div", { class: "det" }, kv([
          [l.ai ? "AI saw" : l.verdict === "unmeasured" ? "Why not" : "We saw", l.evidence.join(" ")],
          ["The idea", l.summary],
          l.verdict !== "unmeasured" ? ["We checked", l.how] : null,
          l.fix && ["not", "partly"].includes(l.verdict) ? ["Try", l.fix] : null,
          l.caveat ? ["Caution", l.caveat] : null,
          ["Source", link(l.source || "Source", l.url)],
        ])));
      }
      list.append(it);
    });
    frag.append(list);
  });
  frag.append(el("p", { class: "xs", style: "margin:6px 2px 0", text: "UX laws are rules of thumb, not legal rules. Each verdict uses a measurable stand-in and doesn't change the score." }));
  return frag;
}

// ---------------------------------------------------------------- rules
function buildRules() {
  const rec = App.rec, frag = el("div", {});
  const basis = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" }, el("span", { class: "xs", text: "Based on" }));
  ruleBasis(rec).forEach((t) => basis.append(pill("p-info", t)));
  frag.append(card({ style: "padding:12px 14px" }, basis, el("p", { class: "xs", style: "margin:8px 0 0", text: "A page can't show where a business is based. Check the \"To confirm\" line on each rule." })));

  groupRules(rec).forEach((g) => {
    if (!g.items.length) return;
    const open = g.key in App.ui.ruleGroup ? App.ui.ruleGroup[g.key] : g.open;
    const gh = fk("rg-" + g.key, el("button", { type: "button", class: "gh", "aria-expanded": String(open) }, pill(g.pill, g.label), el("span", { style: "flex:1;color:#667085;font-weight:500", text: String(g.items.length) }), chev(open)));
    gh.addEventListener("click", () => { App.ui.ruleGroup = { ...App.ui.ruleGroup, [g.key]: !open }; render(); });
    frag.append(gh);
    if (!open) return;
    const list = el("div", { class: "list" });
    g.items.forEach((r) => {
      const o = !!App.ui.ruleOpen[r.id];
      const it = el("div", { class: "it" }, accRow("rule-" + r.id, o, () => { App.ui.ruleOpen = { ...App.ui.ruleOpen, [r.id]: !o }; render(); },
        el("span", { class: "rt", text: r.name }), el("span", { class: "xs", style: "white-space:nowrap", text: r.region })));
      if (o) {
        const tally = r.page.total
          ? (r.page.failed.length ? `${r.page.failed.length} of ${r.page.total} related checks fail: ${r.page.failed.join("; ")}.` : `All ${r.page.total} related checks passed. That doesn't prove compliance.`)
          : (r.verdict === "info" ? null : "No automatic check covers this yet.");
        it.append(el("div", { class: "det" }, kv([
          ["Why", bulletList(r.evidence)],
          tally ? ["On this page", tally] : null,
          r.confirm.length ? ["To confirm", bulletList(r.confirm)] : null,
          ["About", `${r.ruleStatus}. ${r.summary}`],
          r.caveat ? ["Caution", r.caveat] : null,
          ["Sources", (() => { const u = el("ul"); r.sources.forEach((s) => u.append(el("li", {}, link(s.label, s.url)))); return u; })()],
        ])));
      }
      list.append(it);
    });
    frag.append(list);
  });
  frag.append(el("p", { class: "xs", style: "margin:6px 2px 0", text: `Law research dated ${rec.lawsResearchDate || "an unrecorded date"}. General information, not legal advice.` }));
  return frag;
}

// ---------------------------------------------------------------- AI review
async function loadSettings() {
  try { const { ai } = await chrome.storage.local.get("ai"); Object.assign(App.settings, ai || {}); } catch (e) { /* defaults */ }
}
async function saveSettings() { try { await chrome.storage.local.set({ ai: App.settings }); } catch (e) { /* not persisted */ } }

async function getInstallId() {
  try {
    let { installId } = await chrome.storage.local.get("installId");
    if (!installId) { installId = crypto.randomUUID(); await chrome.storage.local.set({ installId }); }
    return installId;
  } catch (e) { return ""; }
}

// Page text is only sent over https (plain http is allowed just for localhost while testing).
function serverUrlProblem(u) {
  if (!u) return "AI review isn't set up yet. Add your review server's address in Settings.";
  let x;
  try { x = new URL(u); } catch (e) { return "That server address isn't valid. Example: http://localhost:8787"; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  if (x.protocol === "https:" || (x.protocol === "http:" && local)) return "";
  return "For safety, page text is only sent to https addresses (or localhost while testing).";
}

const clamp = (s, n) => String(s || "").slice(0, n);
function buildAiPayload(result, laws, screenshot) {
  return {
    url: clamp(safeUrl(result.url), 2000),
    title: clamp(result.title, 300),
    metaDescription: clamp(result.pageContent.metaDescription, 500),
    headings: result.pageContent.headings.map((h) => clamp(h, 200)).slice(0, 40),
    navLabels: (result.ux.navLabels || []).map((n) => clamp(n, 80)).slice(0, 30),
    ctas: (result.ux.ctaLabels || []).map((n) => clamp(n, 80)).slice(0, 20),
    text: clamp(result.pageContent.text, 12000),
    profileSummary: describeProfile(result.profile).map((p) => clamp(p, 200)).slice(0, 20),
    failed: result.checks.filter((c) => c.status === "fail").map((c) => ({ title: clamp(c.title, 200), severity: c.severity, count: c.count })).slice(0, 40),
    passedCount: result.summary.passed,
    score: result.score,
    uxLaws: laws.filter((l) => l.verdict !== "unmeasured").slice(0, 25).map((l) => ({ name: clamp(l.name, 100), verdict: clamp(l.verdict, 30), evidence: clamp(l.evidence[0], 300) })),
    screenshot: screenshot || undefined,
  };
}

async function captureScreenshot() {
  for (const quality of [60, 40]) {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality });
    const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    if (b64.length <= 5_000_000) return b64;
  }
  return null;
}

async function runAi() {
  const s = App.settings;
  if (!App.live || !App.cur) { ui({ aiErr: "Scan the page again to run the AI review. It needs the page's text." }); return; }
  if (!s.consent) { ui({ aiErr: "Tick the box above first. Nothing is sent without it." }); return; }
  const problem = serverUrlProblem(s.serverUrl);
  if (problem) { ui({ aiErr: problem }); return; }
  ui({ aiStatus: "run", aiErr: "" });
  let screenshot = null;
  if (s.screenshot) { try { screenshot = await captureScreenshot(); } catch (e) { /* text only */ } }
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const resp = await fetch(s.serverUrl.replace(/\/+$/, "") + "/api/review", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json", "x-install-id": await getInstallId() }, s.token ? { "x-app-token": s.token } : {}),
      body: JSON.stringify(buildAiPayload(App.cur.result, App.cur.laws, screenshot)),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* not JSON */ }
    if (!resp.ok) { ui({ aiStatus: "idle", aiErr: data && data.message ? data.message : `The server answered with an error (${resp.status}).` }); return; }
    App.cur.ai = data;
    App.cur.aiShot = { requested: s.screenshot, sent: !!screenshot };
    App.cur.laws = mergeAiLaws(App.cur.baseLaws, data.review);
    ui({ aiStatus: "done", aiOut: data, aiMsg: "" });
    App.ui.lawGroup = { ...App.ui.lawGroup, ai: true };
    toast(data.mock ? "Sample data shown (mock mode)" : "AI review ready");
    await persist();
  } catch (e) {
    ui({ aiStatus: "idle", aiErr: e && e.name === "AbortError" ? "The review took too long and was cancelled. Try again." : `Can't reach the review server at ${s.serverUrl}. Is it running?` });
  } finally { clearTimeout(timer); }
}

function aiResultsNode(res, shot) {
  const ai = res.review, box = el("div", { class: "air" });
  box.append(res.mock
    ? el("div", { class: "aib mock", text: "SAMPLE DATA from the server's mock mode. This is NOT a review of your page." })
    : el("div", { class: "aib", text: `AI-generated by Claude${res.servedBy ? " (" + res.servedBy + ")" : ""}. It can be wrong. Check it against the page.` }));
  if (shot) box.append(el("div", { class: "xs", style: "margin-bottom:8px", text: shot.sent ? "A screenshot of the first screen was included." : "No screenshot was included, so visual judgments are limited." }));
  box.append(el("p", { text: ai.summary }));
  const clarity = { clear: "Clear", somewhat_clear: "Somewhat clear", unclear: "Unclear" }[ai.usp.clarity];
  box.append(el("h4", { text: "USP" }), el("p", { class: "usp", text: ai.usp.statement }), el("p", { class: "xs", text: `How clearly the page says it: ${clarity} (AI confidence: ${ai.usp.confidence})` }));
  if (ai.usp.evidence.length) box.append(bulletList(ai.usp.evidence));
  if (ai.usp.improvement) box.append(el("p", { class: "sm", text: "To sharpen it: " + ai.usp.improvement }));
  if (ai.priorities.length) { box.append(el("h4", { text: "Top priorities" })); const ol = el("ol", { style: "margin:0;padding-left:18px" }); ai.priorities.forEach((p) => ol.append(el("li", { text: p }))); box.append(ol); }
  box.append(el("h4", { text: `What works (${ai.strengths.length})` }));
  ai.strengths.forEach((s) => box.append(el("p", {}, el("b", { text: s.title + ". " }), document.createTextNode(s.detail))));
  box.append(el("h4", { text: `What doesn't (${ai.weaknesses.length})` }));
  ai.weaknesses.forEach((w) => box.append(el("p", {}, pill("p-" + (w.severity === "medium" ? "med" : w.severity), w.severity.toUpperCase()), document.createTextNode(" "), el("b", { text: w.title + ". " }), document.createTextNode(w.detail + " Fix: " + w.fix))));
  if (ai.limitations) box.append(el("p", { class: "xs", style: "margin-top:10px", text: "What the AI couldn't judge: " + ai.limitations }));
  return box;
}

function buildAi() {
  const rec = App.rec, frag = el("div", {});
  const s = App.settings, lc = lawCounts(rec);
  const c = card({}, el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px" }, el("div", { class: "h2", style: "margin:0;flex:1", text: "AI review" }), pill("p-rev", "Uses Claude")),
    el("p", { class: "sm mut", style: "margin:0 0 4px", text: `Adds what code can't judge: the page's USP, what works, what doesn't, and the ${lc.unmeasured + lc.ai} laws that need a human or AI eye.` }));

  const saved = rec.ai;
  if (App.ui.aiStatus === "run") {
    c.append(el("div", { class: "step", style: "margin-top:6px" }, el("div", { class: "dot d-run" }), el("div", { text: "Reviewing the page. This takes about 20 seconds." })));
  } else if (App.ui.aiStatus === "done" && App.ui.aiOut) {
    c.append(aiResultsNode(App.ui.aiOut, App.cur && App.cur.aiShot));
  } else if (saved) {
    c.append(aiResultsNode({ review: saved.review, servedBy: saved.servedBy, mock: false }, { sent: saved.screenshotSent }));
  } else if (!App.live) {
    c.append(el("p", { class: "xs", style: "margin:8px 0 0", text: "This is a saved audit. Scan the page again to run the AI review: it needs the page's text." }));
  } else if (!s.serverUrl) {
    const b = el("button", { type: "button", class: "btn pri sm2", text: "Set up review server" }); b.addEventListener("click", () => { App.ui.editServer = true; openSheet("set"); });
    c.append(el("p", { class: "xs", style: "margin:8px 0" , text: "The AI review needs a review server. Set one up, or use your own AI chat below: it's free and needs no server." }), b);
  } else {
    const consent = el("input", { type: "checkbox", id: "ai-consent" }); consent.checked = !!s.consent;
    consent.addEventListener("change", () => { App.settings.consent = consent.checked; App.ui.aiErr = ""; saveSettings(); render(); });
    const shot = el("input", { type: "checkbox", id: "ai-shot" }); shot.checked = s.screenshot !== false;
    shot.addEventListener("change", () => { App.settings.screenshot = shot.checked; saveSettings(); });
    const run = fk("run-ai", el("button", { type: "button", class: "btn pri", style: "width:100%", text: "Run AI review" }));
    run.addEventListener("click", runAi);
    c.append(el("label", { class: "chk" }, consent, el("span", { text: "Send this page's text (about 9,000 characters) to my review server and Anthropic's API." })));
    if (App.ui.aiErr) c.append(el("div", { class: "err", role: "alert", text: App.ui.aiErr }));
    c.append(el("label", { class: "chk" }, shot, el("span", { text: "Include a screenshot. Needed to judge the visual laws." })), run);
  }
  frag.append(c);

  // Free chat hand-off: built once so what the user typed survives redraws.
  if (!chatNode) chatNode = renderChatPanel({
    getRecord: async () => App.rec,
    // Saved audits don't keep the page's text, so only live scans can include it.
    getPageContent: App.live && App.cur ? () => App.cur.result.pageContent : undefined,
    onToast: (t) => toast(t),
  });
  frag.append(chatNode);
  return frag;
}

// ---------------------------------------------------------------- sheets
let sheetOpener = null;
function openSheet(kind) {
  sheetOpener = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
  App.ui.sheet = kind;
  App.ui.confirmClear = false;
  if (kind === "hist") AuditStore.list().then((l) => { App.ui.histList = l; render(); });
  if (kind === "set") AuditStore.prefs().then((p) => { App.ui.saveHist = p.saveHistory; render(); });
  render();
}
function closeSheet() { App.ui.sheet = null; App.ui.editServer = false; lastFocusKey = sheetOpener; render(); }

function buildSheet() {
  const kind = App.ui.sheet;
  if (!kind) return null;
  const close = fk("sheet-close", el("button", { type: "button", class: "ib", "aria-label": "Close" }, icon("close", 18)));
  close.addEventListener("click", closeSheet);
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": kind === "hist" ? "History" : "Settings" },
    el("div", { style: "display:flex;align-items:center;margin-bottom:10px" }, el("div", { class: "h2", style: "flex:1;margin:0;font-size:15px", text: kind === "hist" ? "History" : "Settings" }), close));

  if (kind === "hist") {
    const list = App.ui.histList;
    if (!list.length) sheet.append(el("p", { class: "xs", style: "margin:0 0 8px", text: "No audits yet. Scans you run are saved here, on this device only." }));
    else {
      const l = el("div", { class: "list", style: "max-height:300px;overflow:auto" });
      list.slice(0, 8).forEach((e) => { const r = recentRow(e); r.addEventListener("click", () => { App.ui.sheet = null; render(); }); l.append(r); });
      sheet.append(l);
      const all = el("button", { type: "button", class: "lnk", text: "See all and compare" }); all.addEventListener("click", () => openTab("history.html"));
      sheet.append(el("div", { style: "margin-bottom:6px" }, all));
    }
    sheet.append(el("p", { class: "xs", style: "margin:0", text: "Saved on this device only. Turn this off in Settings." }));
  } else {
    const sw = el("button", { type: "button", class: App.ui.saveHist ? "sw on" : "sw", role: "switch", "aria-checked": String(App.ui.saveHist), "aria-label": "Save audits to history" }, el("i"));
    sw.addEventListener("click", async () => { await AuditStore.setPrefs({ saveHistory: !App.ui.saveHist }); App.ui.saveHist = !App.ui.saveHist; if (App.cur) await persist(); else render(); });
    sheet.append(el("div", { class: "swl" }, el("div", { style: "flex:1" }, el("div", { style: "font-weight:600;font-size:13px", text: "Save audits to history" }), el("div", { class: "xs", text: "Kept on this device only" })), sw));

    const host = App.settings.serverUrl ? hostOf(App.settings.serverUrl) || App.settings.serverUrl : "";
    const setup = el("button", { type: "button", class: "btn sm2", text: App.ui.editServer ? "Cancel" : host ? "Change" : "Set up" });
    setup.addEventListener("click", () => ui({ editServer: !App.ui.editServer }));
    sheet.append(el("div", { class: "swl" }, el("div", { style: "flex:1;min-width:0" }, el("div", { style: "font-weight:600;font-size:13px", text: "Review server" }), el("div", { class: "xs", style: "overflow:hidden;text-overflow:ellipsis", text: host ? `Used only for AI review · ${host}` : "Used only for AI review. Not set up." })), setup));
    if (App.ui.editServer) {
      const url = el("input", { type: "text", class: "fld", id: "srv-url", value: App.settings.serverUrl, placeholder: "https://your-server.example.com", spellcheck: "false" });
      const tok = el("input", { type: "password", class: "fld", id: "srv-tok", value: App.settings.token, autocomplete: "off" });
      const err = el("div", { class: "err", role: "alert" });
      const save = el("button", { type: "button", class: "btn pri sm2", text: "Save" });
      save.addEventListener("click", async () => {
        const v = url.value.trim().replace(/\/+$/, "");
        const p = v ? serverUrlProblem(v) : "";
        if (p) { err.textContent = p; return; }
        App.settings.serverUrl = v; App.settings.token = tok.value;
        await saveSettings(); App.ui.editServer = false; render(); toast("Review server saved");
      });
      sheet.append(el("div", { style: "padding:4px 0 10px" },
        el("label", { class: "lab", for: "srv-url", text: "Server address" }), url,
        el("label", { class: "lab", for: "srv-tok", text: "App token (only if your server uses one)" }), tok, err,
        el("div", { style: "margin-top:10px" }, save)));
    }
    const clear = el("button", { type: "button", class: "lnk", style: "color:#B42318", text: App.ui.confirmClear ? "Click again to delete all history" : "Clear history" });
    clear.addEventListener("click", async () => {
      if (!App.ui.confirmClear) { ui({ confirmClear: true }); return; }
      await AuditStore.clearAll(); App.recents = []; App.ui.histList = []; App.ui.confirmClear = false; render(); toast("History cleared");
    });
    sheet.append(clear);
  }

  const scrim = el("div", { class: "scrim" }, sheet);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSheet(); });
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = [...sheet.querySelectorAll("button, input, a[href], select, textarea")].filter((n) => !n.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return scrim;
}

// ---------------------------------------------------------------- render
function buildBody() {
  const bd = el("div", { class: "bd", id: "tabpanel" });
  if (App.screen === "done") bd.setAttribute("role", "tabpanel"), bd.setAttribute("aria-labelledby", "tab-" + App.tab);
  if (App.screen === "start") bd.append(buildStart());
  else if (App.screen === "scan") bd.append(buildScanning());
  else if (App.screen === "done") {
    if (App.stale && App.live) {
      const b = el("button", { type: "button", class: "btn sm2 pri", text: "Scan this page" });
      b.addEventListener("click", scan);
      bd.append(el("div", { class: "banner", role: "status" }, el("span", { text: "You've moved on from this page. These results are for the page you scanned." }), b));
    }
    bd.append({ overview: buildOverview, issues: buildIssues, laws: buildLaws, rules: buildRules, ai: buildAi }[App.tab]());
  } else bd.append(buildProblem());
  return bd;
}

function render({ resetScroll = false } = {}) {
  const old = document.querySelector(".bd");
  const scroll = old && !resetScroll ? old.scrollTop : 0;
  const active = document.activeElement;
  const key = lastFocusKey || (active && active.dataset ? active.dataset.fk : null);
  lastFocusKey = null;
  // Keep the chat card alive across redraws (it holds what the user typed).
  if (chatNode && chatNode.parentNode) chatNode.remove();

  const shell = el("div", { style: "display:flex;flex-direction:column;flex:1;min-height:0;position:relative" }, buildHeader(), buildBody());
  const sheet = buildSheet();
  if (sheet) shell.append(sheet);
  $("app").replaceChildren(shell);

  const bd = document.querySelector(".bd");
  if (bd) bd.scrollTop = scroll;
  if (sheet) {
    // While a sheet is open, focus stays inside it: keep the focused control if it is in the sheet, else the close button.
    const inSheet = key ? sheet.querySelector(`[data-fk="${CSS.escape(key)}"]`) : null;
    const target = inSheet || sheet.querySelector("[data-fk='sheet-close']");
    if (target) target.focus({ preventScroll: true });
  } else if (key) {
    const n = document.querySelector(`[data-fk="${CSS.escape(key)}"]`);
    if (n) n.focus({ preventScroll: true });
  }
}

// ---------------------------------------------------------------- scanning
const query = new URLSearchParams(location.search);
async function getTargetTab() {
  const forced = Number(query.get("tabId"));        // used by automated tests
  if (forced) return chrome.tabs.get(forced);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}
async function refreshTarget() {
  try {
    const t = await getTargetTab();
    App.target = t ? { id: t.id, title: t.title || "", url: t.url || "" } : null;
  } catch (e) { App.target = null; }
}

function classifyScanError(err, tab) {
  const msg = String((err && err.message) || err || "");
  const url = (tab && tab.url) || (msg.match(/url "([^"]+)"/) || [])[1] || "";
  if (/^(chrome|edge|about|chrome-extension|devtools|view-source):/i.test(url) || /chrome\.google\.com\/webstore|chromewebstore\.google\.com/i.test(url) || /extensions gallery|Chrome Web Store/i.test(msg)) return { kind: "blocked", url };
  if (/Cannot access|permission|activeTab|not allowed|manifest must request/i.test(msg)) {
    let origin = ""; try { if (/^https?:/i.test(url)) origin = new URL(url).origin; } catch (e) { /* unknown */ }
    return { kind: "access", url, origin };
  }
  return { kind: "error", msg };
}

async function allowSite(origin) {
  try {
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (granted) { toast("Allowed. Scanning…"); scan(); } else toast("Not allowed. You can also click the toolbar icon on the page.", true);
  } catch (e) { toast("Couldn't ask Chrome for permission. Click the toolbar icon on the page instead.", true); }
}

async function scan() {
  App.ui.sheet = null;
  // Trying again from a problem screen stays on that screen (no flashing); a first scan shows the progress steps.
  const retry = App.screen === "needaccess" || App.screen === "error";
  const attempts = retry && App.fail ? App.fail.attempts || 0 : 0;
  if (retry) set({ ui: { ...App.ui, retrying: true, sheet: null } });
  else set({ screen: "scan", fail: null, stale: false, ui: { ...App.ui, scanStep: 0, sheet: null, retrying: false } }, { reset: true });
  const started = Date.now();
  const ticker = retry ? null : setInterval(() => { if (App.ui.scanStep < 3) { App.ui.scanStep++; render(); } }, 380);
  let result = null, failure = null, tab = null;
  try {
    tab = await getTargetTab();
    const [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/scanner.js"] });
    result = r;
  } catch (e) { failure = classifyScanError(e, tab); }
  if (!failure && !retry) await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - started))));
  if (retry) await new Promise((r) => setTimeout(r, Math.max(0, 500 - (Date.now() - started))));   // let "Checking…" be seen
  if (ticker) clearInterval(ticker);
  if (failure) {
    App.fail = { ...failure, attempts: attempts + 1 };
    if (failure.kind === "access") watchForAccess();
    set({ screen: failure.kind === "blocked" ? "blocked" : failure.kind === "access" ? "needaccess" : "error", ui: { ...App.ui, retrying: false } }, { reset: !retry });
    return;
  }
  App.ui.retrying = false;
  App.ui.scanStep = 4;
  await ingest(result, tab);
}

// Turn a scan result into a record and show it.
async function ingest(result, tab) {
  const appl = assessApplicability(result.profile, result.checks);
  const baseLaws = assessUxLaws(result.ux, result.profile, result.checks);
  chatNode = null;
  App.cur = { result, appl, baseLaws, laws: baseLaws, ai: null, aiShot: null, savedId: null, savedTs: null, prev: undefined, saveResult: null };
  App.rec = buildAuditRecord(App.cur, VERSION);
  App.live = true;
  App.tabId = tab ? tab.id : null;
  App.stale = false;
  Object.assign(App.ui, { issueOpen: {}, lawOpen: {}, lawGroup: { not: true }, ruleOpen: {}, ruleGroup: { may: true }, filter: "all", passOpen: false, aiStatus: "idle", aiErr: "", aiOut: null });
  set({ screen: "done", tab: "overview" }, { reset: true });
  await persist();
}

// Save (or update) the current audit on this device.
async function persist() {
  if (!App.cur) return;
  const prefs = await AuditStore.prefs();
  const rec = buildAuditRecord(App.cur, VERSION);
  App.cur.savedId = rec.id; App.cur.savedTs = rec.ts;
  App.rec = rec;
  if (prefs.saveHistory && App.cur.prev === undefined) App.cur.prev = await AuditStore.previousFor(rec);
  App.cur.saveResult = await AuditStore.save(rec, prefs.saveHistory);
  await loadRecents();
  render();
}

async function loadRecents() { try { App.recents = await AuditStore.list(); } catch (e) { App.recents = []; } }

async function openSaved(id) {
  const rec = await AuditStore.getAudit(id);
  if (!rec) { toast("That audit is no longer saved.", true); await loadRecents(); render(); return; }
  Object.assign(App.ui, { issueOpen: {}, lawOpen: {}, lawGroup: { not: true }, ruleOpen: {}, ruleGroup: { may: true }, filter: "all", passOpen: false, aiStatus: "idle", aiErr: "", aiOut: null, sheet: null });
  chatNode = null;
  App.cur = null; App.live = false; App.tabId = null; App.stale = false;
  set({ rec, screen: "done", tab: "overview" }, { reset: true });
}

// ---------------------------------------------------------------- tab tracking
function watchTabs() {
  // (Automated tests pin the panel to one tab; they only need the "page navigated" signal.)
  if (!query.get("tabId")) chrome.tabs.onActivated.addListener(async (info) => {
    await refreshTarget();
    if (App.screen === "done" && App.live && App.tabId !== info.tabId) App.stale = true;
    render();
  });
  chrome.tabs.onUpdated.addListener(async (tabId, change) => {
    if (App.screen === "done" && App.live && tabId === App.tabId && (change.status === "loading" || change.url)) { App.stale = true; render(); }
    if (App.target && tabId === App.target.id && (change.title || change.url || change.status === "complete")) { await refreshTarget(); if (App.screen === "start") render(); }
  });
}

// ---------------------------------------------------------------- start
const UX_CHECK_COUNT = 22;
let UX_LAW_COUNT = 23;
(async function init() {
  try { UX_LAW_COUNT = assessUxLaws({ navItems: null, navLabels: [], ctaLabels: [], aboveFoldChoices: 0, targetsTotal: 0, targets24: 0, targets44: 0, filledCount: 0, largestFilledPx: 0, logoTopLeft: false, navNearTop: false, footerLinks: 0, searchPresent: false, cartTopRight: false, totalLinks: 0, paragraphs: 0, longParagraphs: 0, longestParagraph: 0, totalWords: 0, headingCount: 0, loadMs: null, fcpMs: null, inlineLinks: 0, distinctLinks: 0, fontFamilies: [], formFields: 0, helpLinks: 0, statusSignals: 0, currentMarks: 0, stepper: false, dialogs: 0, dialogsWithClose: 0, backLinks: 0, typeChecked: 0, typeMismatch: 0, validationHints: 0, errorWired: 0, errorRegions: 0, personalFields: 0, personalWithAutocomplete: 0, skipLink: false }, null, []).length; } catch (e) { /* keep default */ }
  await Promise.all([loadSettings(), loadRecents(), refreshTarget(), AuditStore.prefs().then((p) => { App.ui.saveHist = p.saveHistory; })]);
  render();
  watchTabs();
})();

// Handles for automated tests (harmless in normal use).
window.UXAB = { App, scan, ingest, openSaved, render, persist, goTab };
