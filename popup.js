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
  body.append(el("div", { class: "ref", text: `Reference: ${c.ref}` }));
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

  root.append(el("div", { class: "note", text:
    "These are automatic rule-based checks, a first pass rather than a full audit. " +
    "Coming next: UX laws, regulations with sources, USP analysis and a downloadable report." }));

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
