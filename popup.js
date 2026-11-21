// POPUP script: the little window that opens when you click the icon.
// It asks the content script to audit the page, then draws the results.
//
// SECURITY NOTE: results contain text copied from the audited website.
// We only ever put it in the page with textContent (never innerHTML),
// so a malicious site can't inject code into our popup.

const $ = (id) => document.getElementById(id);

// Tiny helper to build elements safely.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

// Links come only from our own knowledge base (never from the audited page),
// and we still insist on https.
function link(label, url) {
  const a = el("a", { text: label });
  if (/^https:\/\//.test(url)) {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}

function refItem(name, summary, url, extra) {
  const li = el("li", {}, link(name, url), document.createTextNode(` — ${summary}`));
  if (extra) li.append(el("div", { class: "caveat", text: extra }));
  return li;
}

// "Laws & rules behind this" block for one check.
function renderRefs(c) {
  const m = (typeof CHECK_REFS !== "undefined" && CHECK_REFS[c.id]) || null;
  if (!m) return el("div", { class: "ref", text: `Reference: ${c.ref}` });
  const ul = el("ul", { class: "refs" });
  (m.laws || []).forEach((k) => { const r = LAWS[k]; ul.append(refItem(r.name, r.summary, r.url, r.caveat)); });
  (m.wcag || []).forEach((k) => { const r = WCAG[k]; ul.append(refItem(r.name, r.summary, r.url)); });
  const regs = [...(m.regs || []), ...(m.a11yRegs ? A11Y_REGS : [])];
  regs.forEach((k) => {
    const r = REGS[k];
    ul.append(refItem(r.name, `${r.region}. ${r.status}`, r.sources[0].url));
  });
  const wrap = el("div", { class: "refbox" }, el("b", { text: "Laws & rules behind this" }));
  if (ul.children.length) wrap.append(ul);
  if (m.a11yRegs) wrap.append(el("div", { class: "caveat", text: "Accessibility laws mostly point to WCAG 2.1 AA. Check which apply to your site and country; this is not legal advice." }));
  if (m.note) wrap.append(el("div", { class: "note-inline", text: m.note }));
  return wrap;
}

// Watchlist of regulations at the bottom of the report.
function renderWatchlist() {
  const box = el("div", {});
  box.append(el("h2", { text: "Rules & regulations watchlist" }));
  box.append(el("div", { class: "caveat", text: `Researched via web search on ${VERIFIED_ON}. Laws change quickly. General information, not legal advice.` }));
  Object.values(REGS).forEach((r) => {
    const body = el("div", { class: "body" },
      el("p", {}, document.createTextNode(r.summary)));
    if (r.caveat) body.append(el("p", { class: "caveat", text: "Caution: " + r.caveat }));
    const ul = el("ul", { class: "refs" });
    r.sources.forEach((src) => ul.append(el("li", {}, link(src.label, src.url))));
    body.append(el("p", {}, el("b", { text: "Sources" }), ul));
    box.append(el("details", {},
      el("summary", {}, el("span", { text: r.name }), el("span", { class: "count", text: r.region })),
      el("div", { class: "status", text: r.status }),
      body));
  });
  return box;
}

const scoreColor = (s) => (s >= 80 ? "var(--pass)" : s >= 60 ? "var(--medium)" : "var(--high)");

function renderIssue(c) {
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
  body.append(renderRefs(c));
  return el("details", {},
    el("summary", {},
      el("span", { class: `badge ${c.severity}`, text: c.severity }),
      el("span", { text: c.title }),
      el("span", { class: "count", text: String(c.count) }),
    ),
    body,
  );
}

function render(result) {
  const root = $("report");
  root.replaceChildren();

  const catChips = el("div", { class: "cats" });
  Object.entries(result.categoryScores).forEach(([name, s]) =>
    catChips.append(el("span", { class: "chip", text: `${name} ${s}` })));

  const score = el("div", { class: "score", text: String(result.score) },
    el("small", { text: "/ 100" }));
  score.style.setProperty("--c", scoreColor(result.score));

  root.append(
    el("div", { class: "page", text: `${result.title} — ${result.url}` }),
    el("div", { class: "score-row" }, score, el("div", {},
      el("div", { text: `${result.summary.failed} issues found, ${result.summary.passed} checks passed` }),
      catChips)),
  );

  const order = { high: 0, medium: 1, low: 2 };
  const failed = result.checks.filter((c) => c.status === "fail").sort((a, b) => order[a.severity] - order[b.severity]);
  const passed = result.checks.filter((c) => c.status === "pass");

  root.append(el("h2", { text: `Needs attention (${failed.length})` }));
  if (failed.length) failed.forEach((c) => root.append(renderIssue(c)));
  else root.append(el("div", { text: "No issues found by the automatic checks. Nice work!" }));

  root.append(el("h2", { text: `Done right (${passed.length})` }));
  const ul = el("ul", { class: "pass-list" });
  passed.forEach((c) => ul.append(el("li", { text: c.title })));
  root.append(ul);

  root.append(renderWatchlist());

  root.append(el("div", { class: "note", text:
    "These are automatic rule-based checks, a first pass rather than a full audit. " +
    "Coming next: USP analysis and a downloadable report." }));

  root.hidden = false;
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
    render(result);
  } catch (e) {
    status.textContent = "Can't scan this page. Chrome blocks internal pages like chrome:// and the Web Store. " + e.message;
  } finally {
    btn.disabled = false;
  }
}

$("scan").addEventListener("click", scan);
