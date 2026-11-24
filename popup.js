// POPUP script: the little window that opens when you click the icon.
// It asks the content script to audit the page, then draws the results.
// Optionally (only when the user clicks "Run AI review") it sends the page's
// text + a screenshot to the user's own review server for an AI opinion.
//
// SECURITY NOTE: results contain text copied from the audited website, and
// the AI's answer is derived from it. We only ever put text in the page with
// textContent (never innerHTML), so neither can inject code into our popup.

const $ = (id) => document.getElementById(id);

const STATUS_LABEL = {
  likely: "Likely applies",
  may: "May apply",
  pending: "Proposed, not law yet",
  unknown: "Can't tell",
  unlikely: "Probably doesn't apply",
  info: "For information",
};
const chip = (status) => el("span", { class: `st ${status}`, text: STATUS_LABEL[status] });
const verdictChip = (v) => el("span", { class: `vd ${v}`, text: VERDICT_LABEL[v] });

// What the last scan and AI review produced (Step 5 will use this for the report).
let current = null;

// Inside an open issue card: which UX laws does this relate to, and does the
// page follow them? (Regulations live in "Which rules apply to this site?".)
function renderRefs(c, laws, profile) {
  const m = CHECK_REFS[c.id] || {};
  const wrap = el("div", { class: "refbox" }, el("b", { text: "UX laws & heuristics" }));

  const related = (m.uxLaws || []).map((id) => laws.find((l) => l.id === id)).filter(Boolean);
  if (related.length) {
    const ul = el("ul", { class: "refs" });
    related.forEach((l) => {
      const li = el("li", {}, verdictChip(l.verdict), document.createTextNode(" "), link(l.name, l.url));
      if (l.evidence[0]) li.append(el("div", { class: "caveat", text: l.evidence[0] }));
      ul.append(li);
    });
    wrap.append(ul);
  } else {
    wrap.append(el("div", { class: "caveat", text: "No UX law is measured for this issue." }));
  }

  if ((m.wcag || []).length) {
    const wl = el("ul", { class: "refs" });
    m.wcag.forEach((k) => { const r = WCAG[k]; wl.append(el("li", {}, link(r.name, r.url), document.createTextNode(` — ${r.summary}`))); });
    wrap.append(el("b", { class: "sub", text: "Accessibility standard" }), wl);
  }

  const ctx = pageContextNote(c, profile);
  if (ctx) wrap.append(el("div", { class: "note-inline ctx", text: ctx }));
  if (m.note) wrap.append(el("div", { class: "note-inline", text: m.note }));
  if (m.regs || m.a11yRegs) {
    wrap.append(el("div", { class: "caveat", text: "Which laws and regulations apply to this site is covered in 'Which rules apply to this site?' below." }));
  }
  return wrap;
}

function renderIssue(c, laws, profile) {
  const body = el("div", { class: "body" },
    el("p", {}, el("b", { text: "Why it matters" }), document.createTextNode(c.why)),
    el("p", {}, el("b", { text: "How to fix" }), document.createTextNode(c.fix)),
  );
  if (c.examples.length) {
    const ul = el("ul");
    c.examples.forEach((x) => ul.append(el("li", { text: x })));
    if (c.count > c.examples.length) ul.append(el("li", { text: `…and ${c.count - c.examples.length} more` }));
    body.append(el("p", {}, el("b", { text: "Found on this page" }), ul));
  }
  body.append(renderRefs(c, laws, profile));
  return el("details", {},
    el("summary", {},
      el("span", { class: `badge ${c.severity}`, text: c.severity }),
      el("span", { text: c.title }),
      el("span", { class: "count", text: String(c.count) }),
    ),
    body,
  );
}

// UX laws scorecard: one card per law, with the measured evidence.
function renderUxLaws(laws) {
  const box = el("div", { id: "uxlaws-box" });
  const count = (v) => laws.filter((l) => l.verdict === v).length;
  box.append(el("h2", { text: "UX laws & heuristics scorecard" }));
  box.append(el("div", { class: "uxsum", text:
    `${count("followed")} followed · ${count("partly")} partly · ${count("not")} not followed · ${count("na")} not enough to judge · ${count("unmeasured")} need human/AI review` }));
  box.append(el("div", { class: "caveat", text:
    "UX laws are psychology principles, not legal rules. Each verdict is a measurable stand-in (a proxy) and the cut-offs are our rules of thumb, explained in every card. They don't affect the score." }));

  laws.forEach((l) => {
    const body = el("div", { class: "body" });
    const ev = el("ul");
    l.evidence.forEach((e) => ev.append(el("li", { text: e })));
    body.append(el("p", {}, el("b", { text: l.verdict === "unmeasured" ? "Why we can't measure it" : l.ai ? "What the AI saw" : "What we measured" }), ev));
    if (l.verdict !== "unmeasured") body.append(el("p", {}, el("b", { text: "How we judged it" }), document.createTextNode(l.how)));
    if (l.fix && (l.verdict === "not" || l.verdict === "partly")) body.append(el("p", {}, el("b", { text: "How to improve" }), document.createTextNode(l.fix)));
    body.append(el("p", {}, el("b", { text: "What the law says" }), document.createTextNode(l.summary + " "), link(`${l.source || "Source"}`, l.url)));
    if (l.caveat) body.append(el("p", { class: "caveat", text: "Caution: " + l.caveat }));
    box.append(el("details", {},
      el("summary", {},
        verdictChip(l.verdict),
        el("span", { text: l.name }),
        l.ai ? el("span", { class: "aitag", text: "AI" }) : null,
        l.partial ? el("span", { class: "count", text: "partial" }) : null),
      body));
  });
  return box;
}

// "Which rules apply to this site?": one card per regulation.
function renderApplicability(appl) {
  const box = el("div", {});
  box.append(el("h2", { text: "Which rules apply to this site?" }));
  box.append(el("div", { class: "caveat", text:
    `Worked out from signals on this page (domain, currency, shop features, forms). Law research dated ${VERDICTS_DATE()}. ` +
    "A web page can't reveal where a business is based or who its customers are, so check the 'To confirm' items. General information, not legal advice." }));

  Object.keys(appl)
    .sort((a, b) => STATUS_ORDER.indexOf(appl[a].status) - STATUS_ORDER.indexOf(appl[b].status))
    .forEach((id) => {
      const r = REGS[id], a = appl[id];
      const body = el("div", { class: "body" });

      body.append(el("p", {}, el("b", { text: "Why this verdict (evidence on this page)" }),
        (() => { const ul = el("ul"); a.evidence.forEach((e) => ul.append(el("li", { text: e }))); return ul; })()));

      if (a.page.total) {
        const msg = a.page.failed.length
          ? `${a.page.failed.length} of ${a.page.total} related automatic checks are failing: ${a.page.failed.join("; ")}.`
          : `All ${a.page.total} related automatic checks passed. Only part of this can be tested automatically, so this doesn't prove compliance.`;
        body.append(el("p", {}, el("b", { text: "What this page shows" }), document.createTextNode(msg)));
      } else if (a.status !== "info") {
        body.append(el("p", {}, el("b", { text: "What this page shows" }), document.createTextNode("No automatic check covers this rule yet.")));
      }

      if (a.confirm.length) {
        const ul = el("ul");
        a.confirm.forEach((t) => ul.append(el("li", { text: t })));
        body.append(el("p", {}, el("b", { text: "To confirm yourself" }), ul));
      }

      body.append(el("p", {}, el("b", { text: "About the rule" }), document.createTextNode(`${r.status}. ${r.summary}`)));
      if (r.caveat) body.append(el("p", { class: "caveat", text: "Caution: " + r.caveat }));
      const src = el("ul", { class: "refs" });
      r.sources.forEach((s) => src.append(el("li", {}, link(s.label, s.url))));
      body.append(el("p", {}, el("b", { text: "Sources" }), src));

      box.append(el("details", {},
        el("summary", {}, chip(a.status), el("span", { text: r.name }), el("span", { class: "count", text: r.region })),
        body));
    });
  return box;
}
// (VERIFIED_ON is a const in references.js; wrapped so a missing global can't break rendering)
function VERDICTS_DATE() { return typeof VERIFIED_ON !== "undefined" ? VERIFIED_ON : "unknown date"; }

// =====================================================================
// AI REVIEW (Step 4)
// =====================================================================
const AI_DEFAULTS = { serverUrl: APP_CONFIG.defaultServerUrl, token: "", consent: false, screenshot: true };

// A random id for this install, sent with AI requests so the server can apply
// per-install limits. It is not tied to you or your browsing, and is created locally.
async function getInstallId() {
  try {
    let { installId } = await chrome.storage.local.get("installId");
    if (!installId) { installId = crypto.randomUUID(); await chrome.storage.local.set({ installId }); }
    return installId;
  } catch (e) { return ""; }
}

// Page text is only sent over https (plain http is allowed just for localhost while testing).
function serverUrlProblem(u) {
  if (!u) return "AI review isn't set up yet. Add your review server's address under 'Review server settings'.";
  let x;
  try { x = new URL(u); } catch (e) { return "That server address isn't valid. Example: http://localhost:8787"; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  if (x.protocol === "https:" || (x.protocol === "http:" && local)) return "";
  return "For safety, page text is only sent to https addresses (or localhost while testing).";
}

async function loadAiSettings() {
  try {
    const { ai } = await chrome.storage.local.get("ai");
    return Object.assign({}, AI_DEFAULTS, ai || {});
  } catch (e) { return Object.assign({}, AI_DEFAULTS); }
}
async function saveAiSettings(s) {
  try { await chrome.storage.local.set({ ai: s }); } catch (e) { /* storage unavailable: settings just won't persist */ }
}

// A gentle warning for pages that probably show private information.
function looksPrivate(url) {
  try {
    const u = new URL(url);
    return /(mail|bank|account|login|signin|sign-in|checkout|payment|billing|patient|health|admin|dashboard)/i.test(u.hostname + u.pathname);
  } catch (e) { return false; }
}

const clamp = (s, n) => String(s || "").slice(0, n);

function buildAiPayload(result, laws, screenshot) {
  const failed = result.checks.filter((c) => c.status === "fail")
    .map((c) => ({ title: clamp(c.title, 200), severity: c.severity, count: c.count }));
  return {
    url: clamp(safeUrl(result.url), 2000),
    title: clamp(result.title, 300),
    metaDescription: clamp(result.pageContent.metaDescription, 500),
    headings: result.pageContent.headings.map((h) => clamp(h, 200)).slice(0, 40),
    navLabels: (result.ux.navLabels || []).map((n) => clamp(n, 80)).slice(0, 30),
    ctas: (result.ux.ctaLabels || []).map((n) => clamp(n, 80)).slice(0, 20),
    text: clamp(result.pageContent.text, 12000),
    profileSummary: describeProfile(result.profile).map((p) => clamp(p, 200)).slice(0, 20),
    failed: failed.slice(0, 40),
    passedCount: result.summary.passed,
    score: result.score,
    uxLaws: laws.filter((l) => l.verdict !== "unmeasured").slice(0, 20)
      .map((l) => ({ name: clamp(l.name, 100), verdict: clamp(l.verdict, 30), evidence: clamp(l.evidence[0], 300) })),
    screenshot: screenshot || undefined,
  };
}

// Capture what's on screen as a compressed JPEG (base64, no data: prefix).
async function captureScreenshot() {
  for (const quality of [60, 40]) {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality });
    const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    if (b64.length <= 5_000_000) return b64;
  }
  return null;
}

function renderAiResults(res, shotInfo) {
  const ai = res.review;
  const box = el("div", { class: "airesults" });

  box.append(res.mock
    ? el("div", { class: "aibanner mock", text: "SAMPLE DATA from the server's mock mode. This is NOT a review of your page." })
    : el("div", { class: "aibanner", text: `AI-generated by Claude${res.servedBy ? " (" + res.servedBy + ")" : ""}. It can be wrong. Check it against the page.` }));

  if (shotInfo) {
    const t = shotInfo.sent ? "Screenshot of the first screen was included."
      : shotInfo.requested ? "A screenshot was requested but couldn't be captured, so the AI worked from text only (visual judgments are limited)."
      : "No screenshot was included, so visual judgments are limited.";
    box.append(el("div", { class: "caveat", text: t }));
  }
  box.append(el("p", { class: "aisummary", text: ai.summary }));

  const usp = ai.usp;
  const clarity = { clear: "Clear", somewhat_clear: "Somewhat clear", unclear: "Unclear" }[usp.clarity];
  const uspBody = el("div", { class: "body" },
    el("p", { class: "usp", text: usp.statement }),
    el("p", {}, el("b", { text: "How clearly the page communicates it" }), document.createTextNode(`${clarity} (AI confidence: ${usp.confidence})`)));
  if (usp.evidence.length) {
    const ul = el("ul"); usp.evidence.forEach((e) => ul.append(el("li", { text: e })));
    uspBody.append(el("p", {}, el("b", { text: "Evidence on the page" }), ul));
  }
  if (usp.improvement) uspBody.append(el("p", {}, el("b", { text: "How to sharpen it" }), document.createTextNode(usp.improvement)));
  const uspCard = el("details", { open: "" }, el("summary", {}, el("span", { class: "badge usp-badge", text: "USP" }), el("span", { text: "What this page promises" })), uspBody);
  box.append(uspCard);

  if (ai.priorities.length) {
    const ol = el("ol", { class: "prio" });
    ai.priorities.forEach((p) => ol.append(el("li", { text: p })));
    box.append(el("h3", { text: "Top priorities" }), ol);
  }

  box.append(el("h3", { text: `What works (${ai.strengths.length})` }));
  ai.strengths.forEach((s) => box.append(el("details", {}, el("summary", {}, el("span", { class: "vd followed", text: "Works" }), el("span", { text: s.title })), el("div", { class: "body" }, el("p", { text: s.detail })))));

  box.append(el("h3", { text: `What doesn't (${ai.weaknesses.length})` }));
  ai.weaknesses.forEach((w) => box.append(el("details", {},
    el("summary", {}, el("span", { class: `badge ${w.severity}`, text: w.severity }), el("span", { text: w.title })),
    el("div", { class: "body" }, el("p", {}, el("b", { text: "What's wrong" }), document.createTextNode(w.detail)), el("p", {}, el("b", { text: "How to fix" }), document.createTextNode(w.fix))))));

  if (ai.limitations) box.append(el("div", { class: "note", text: "What the AI couldn't judge: " + ai.limitations }));
  return box;
}

function renderAiPanel(result, settings) {
  const panel = el("div", { class: "aipanel", id: "ai-box" });
  panel.append(el("h2", { text: "AI review (USP, strengths, deeper judgment)" }));
  panel.append(el("div", { class: "caveat", text:
    "Optional. Runs a Claude review on your own review server. It adds the page's USP, what works and what doesn't, and judges the six UX laws code can't measure." }));

  const consent = el("input", { type: "checkbox", id: "ai-consent" });
  consent.checked = !!settings.consent;
  const shot = el("input", { type: "checkbox", id: "ai-shot" });
  shot.checked = settings.screenshot !== false;
  const url = el("input", { type: "text", id: "ai-url", value: settings.serverUrl, spellcheck: "false" });
  const token = el("input", { type: "password", id: "ai-token", value: settings.token, autocomplete: "off" });
  const runBtn = el("button", { id: "ai-run", class: "primary", text: "Run AI review" });
  const status = el("div", { class: "aistatus", id: "ai-status" });
  const out = el("div", { id: "ai-out" });

  panel.append(
    el("label", { class: "check" }, consent, document.createTextNode(
      " I understand that this page's text (up to about 9,000 characters) and, if ticked below, a screenshot will be sent to my review server and then to Anthropic's API.")),
    el("label", { class: "check" }, shot, document.createTextNode(" Include a screenshot of what's on screen (needed to judge visual laws)")),
  );
  if (looksPrivate(result.url)) {
    panel.append(el("div", { class: "warn", text: "This page may show private information (login, account, payment, mail or admin area). Only run the AI review if you're comfortable sending what's on screen." }));
  }
  panel.append(runBtn, status);

  panel.append(el("details", { class: "settings" },
    el("summary", { text: "Review server settings" }),
    el("div", { class: "body" },
      el("label", { class: "field" }, document.createTextNode("Server address"), url),
      el("label", { class: "field" }, document.createTextNode("App token (only if your server uses one)"), token),
      el("div", { class: "caveat", text: "Start the server with `npm start` inside the server folder (see server/README.md). `npm run mock` gives sample data with no API key." }))));
  panel.append(out);

  runBtn.addEventListener("click", async () => {
    const s = { serverUrl: url.value.trim().replace(/\/+$/, ""), token: token.value, consent: consent.checked, screenshot: shot.checked };
    await saveAiSettings(s);
    out.replaceChildren();
    if (!s.consent) { status.textContent = "Tick the consent box first. Nothing is sent until you do."; return; }
    const problem = serverUrlProblem(s.serverUrl);
    if (problem) { status.textContent = problem; return; }

    runBtn.disabled = true;
    try {
      let screenshot = null;
      if (s.screenshot) {
        status.textContent = "Capturing screenshot…";
        try { screenshot = await captureScreenshot(); }
        catch (e) { status.textContent = "Couldn't capture a screenshot, continuing with text only…"; }
      }
      status.textContent = "Asking Claude… this can take up to a minute.";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 150000);
      let resp;
      try {
        resp = await fetch(s.serverUrl + "/api/review", {
          method: "POST",
          headers: Object.assign({ "content-type": "application/json", "x-install-id": await getInstallId() }, s.token ? { "x-app-token": s.token } : {}),
          body: JSON.stringify(buildAiPayload(result, current.laws, screenshot)),
          signal: ctrl.signal,
        });
      } finally { clearTimeout(timer); }

      let data = null;
      try { data = await resp.json(); } catch (e) { /* not JSON */ }
      if (!resp.ok) {
        status.textContent = (data && data.message) ? data.message : `The server answered with an error (${resp.status}).`;
        return;
      }
      status.textContent = "";
      current.ai = data;
      current.aiShot = { requested: s.screenshot, sent: !!screenshot };
      out.replaceChildren(renderAiResults(data, current.aiShot));
      // Fold the AI's opinion on the six unmeasured laws into the scorecard.
      current.laws = mergeAiLaws(current.baseLaws, data.review);
      const old = $("uxlaws-box");
      if (old) old.replaceWith(renderUxLaws(current.laws));
      updateLawGlance();
      await persist();
    } catch (e) {
      status.textContent = e && e.name === "AbortError"
        ? "The review took too long and was cancelled. Try again."
        : `Can't reach the review server at ${s.serverUrl}. Is it running? Open a terminal in the server folder and run: npm start`;
    } finally {
      runBtn.disabled = false;
    }
  });
  return panel;
}

function updateLawGlance() {
  const g = $("laws-glance");
  if (!g || !current) return;
  const lc = (v) => current.laws.filter((l) => l.verdict === v).length;
  g.textContent = `${lc("followed")} followed · ${lc("partly")} partly · ${lc("not")} not followed (details below)`;
}

// =====================================================================
// SAVING, REPORT & HISTORY (Step 5)
// =====================================================================
const openTab = (page) => chrome.tabs.create({ url: chrome.runtime.getURL(page) });

// Save (or update) the current audit on this device. Safe to call again after
// the AI review finishes: it updates the same record.
async function persist() {
  if (!current) return;
  const prefs = await AuditStore.prefs();
  const record = buildAuditRecord(current, chrome.runtime.getManifest().version);
  current.savedId = record.id;
  current.savedTs = record.ts;
  if (prefs.saveHistory && current.prev === undefined) current.prev = await AuditStore.previousFor(record);
  const res = await AuditStore.save(record, prefs.saveHistory);
  current.saveResult = res;
  renderActions();
}

function renderActions() {
  const box = $("report-actions");
  if (!box || !current) return;
  box.replaceChildren();
  const r = current.saveResult;
  const msg = !r ? "Saving…"
    : !r.ok ? "Couldn't save to history (" + r.error + "). You can still open this report now."
    : r.history ? "Saved to history on this device."
    : "History is off. This report is temporary and is replaced by your next scan.";
  box.append(el("b", { text: "Report" }), el("div", { class: "caveat", text: msg }));

  const open = el("button", { class: "primary", text: "Open report" });
  open.disabled = !r || !r.ok;
  open.addEventListener("click", () => openTab(`report.html?id=${r && r.history ? current.savedId : "last"}`));
  const hist = el("button", { text: "History" });
  hist.addEventListener("click", () => openTab("history.html"));
  box.append(el("div", { class: "btnrow" }, open, hist));

  const save = el("input", { type: "checkbox" });
  AuditStore.prefs().then((p) => { save.checked = p.saveHistory; });
  save.addEventListener("change", async () => { await AuditStore.setPrefs({ saveHistory: save.checked }); await persist(); });
  box.append(el("label", { class: "check" }, save, document.createTextNode(" Save audits to history on this device")));

  // Before and after, if this page was audited before.
  if (current.prev && r && r.history) {
    const c = compareAudits(current.prev, buildAuditRecord(current, ""));
    const sign = c.delta > 0 ? "+" : "";
    const line = `Last audit of this page (${new Date(current.prev.ts).toLocaleDateString()}): score ${c.scoreFrom} → ${c.scoreTo} (${sign}${c.delta}). ` +
      `${c.fixed.length} fixed · ${c.regressed.length} new problem${c.regressed.length === 1 ? "" : "s"}.`;
    const see = el("button", { text: "See comparison" });
    see.addEventListener("click", () => openTab(`history.html?compare=${current.prev.id},${current.savedId}`));
    box.append(el("div", { class: "cmpline" + (c.delta < 0 ? " down" : c.delta > 0 ? " up" : "") , text: line }), see);
  }
}

// =====================================================================
// Main render
// =====================================================================
const scoreColor = (s) => (s >= 80 ? "var(--pass)" : s >= 60 ? "var(--medium)" : "var(--high)");

async function render(result) {
  const root = $("report");
  root.replaceChildren();

  const profile = result.profile;
  const appl = assessApplicability(profile, result.checks);
  const baseLaws = assessUxLaws(result.ux, profile, result.checks);
  current = { result, appl, baseLaws, laws: baseLaws, ai: null };

  const catChips = el("div", { class: "cats" });
  Object.entries(result.categoryScores).forEach(([name, s]) =>
    catChips.append(el("span", { class: "chip", text: `${name} ${s}` })));

  const score = el("div", { class: "score", text: String(result.score) },
    el("small", { text: "/ 100" }));
  score.style.setProperty("--c", scoreColor(result.score));

  root.append(
    el("div", { class: "page", text: `${result.title} — ${safeUrl(result.url)}` }),
    el("div", { class: "score-row" }, score, el("div", {},
      el("div", { text: `${result.summary.failed} issues found, ${result.summary.passed} checks passed` }),
      catChips)),
  );

  const about = describeProfile(profile);
  root.append(el("div", { class: "about" },
    el("b", { text: "About this site (detected)" }),
    el("div", { text: about.length ? about.join(" · ") : "Not enough signals to classify this page." })));

  root.append(el("div", { class: "about" },
    el("b", { text: "UX laws at a glance" }),
    el("div", { id: "laws-glance" })));
  updateLawGlance();

  root.append(el("div", { class: "about", id: "report-actions" }));
  renderActions();

  // Free "ask your own AI chat" hand-off (no key, nothing sent by the extension).
  root.append(renderChatPanel({
    getRecord: () => buildAuditRecord(current, chrome.runtime.getManifest().version),
    getPageContent: () => result.pageContent,
  }));

  root.append(renderAiPanel(result, await loadAiSettings()));

  const order = { high: 0, medium: 1, low: 2 };
  const failed = result.checks.filter((c) => c.status === "fail").sort((a, b) => order[a.severity] - order[b.severity]);
  const passed = result.checks.filter((c) => c.status === "pass");

  root.append(el("h2", { text: `Needs attention (${failed.length})` }));
  if (failed.length) failed.forEach((c) => root.append(renderIssue(c, current.laws, profile)));
  else root.append(el("div", { text: "No issues found by the automatic checks. Nice work!" }));

  root.append(el("h2", { text: `Done right (${passed.length})` }));
  const ul = el("ul", { class: "pass-list" });
  passed.forEach((c) => ul.append(el("li", { text: c.title })));
  root.append(ul);

  root.append(renderUxLaws(current.laws));
  root.append(renderApplicability(appl));

  root.append(el("div", { class: "note", text:
    "These are automatic rule-based checks plus an optional AI review, a first pass rather than a full audit. " +
    "Use 'Open report' for a printable document you can keep (summary or full)." }));

  root.hidden = false;
  await persist();
}

async function scan() {
  const btn = $("scan"), status = $("status");
  btn.disabled = true;
  status.hidden = false;
  status.textContent = "Scanning…";
  $("report").hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/scanner.js"],
    });
    status.hidden = true;
    await render(result);
  } catch (e) {
    status.textContent = "Can't scan this page. Chrome blocks internal pages like chrome:// and the Web Store. " + e.message;
  } finally {
    btn.disabled = false;
  }
}

$("scan").addEventListener("click", scan);
