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

const STATUS_LABEL = {
  likely: "Likely applies",
  may: "May apply",
  pending: "Proposed, not law yet",
  unknown: "Can't tell",
  unlikely: "Probably doesn't apply",
  info: "For information",
};
const chip = (status) => el("span", { class: `st ${status}`, text: STATUS_LABEL[status] });

function refItem(name, summary, url, extra) {
  const li = el("li", {}, link(name, url), document.createTextNode(` — ${summary}`));
  if (extra) li.append(el("div", { class: "caveat", text: extra }));
  return li;
}

// What kind of page this is can change how serious an issue is.
function pageContextNote(c, profile) {
  const kind = profile && profile.pageKind;
  const m = CHECK_REFS[c.id] || {};
  if (m.a11yRegs && kind === "checkout") return "This is a checkout/payment page. Accessibility failures here can stop someone from completing a purchase.";
  if (m.a11yRegs && kind === "login") return "This is a login/sign-up page. Accessibility failures here can lock people out of an account.";
  if (c.id === "prechecked" && kind === "checkout") return "On a checkout page, pre-ticked extras are most consequential because they change what the buyer pays.";
  return "";
}

// "Laws & rules behind this" block for one check, tailored to this site.
function renderRefs(c, appl, profile) {
  const m = CHECK_REFS[c.id];
  if (!m) return el("div", { class: "ref", text: `Reference: ${c.ref}` });
  const ul = el("ul", { class: "refs" });
  (m.laws || []).forEach((k) => { const r = LAWS[k]; ul.append(refItem(r.name, r.summary, r.url, r.caveat)); });
  (m.wcag || []).forEach((k) => { const r = WCAG[k]; ul.append(refItem(r.name, r.summary, r.url)); });

  const wrap = el("div", { class: "refbox" }, el("b", { text: "Laws & rules behind this" }));
  if (ul.children.length) wrap.append(ul);

  const regs = [...(m.regs || []), ...(m.a11yRegs ? A11Y_REGS : [])];
  if (regs.length) {
    const rl = el("ul", { class: "refs" });
    regs
      .slice()
      .sort((a, b) => STATUS_ORDER.indexOf(appl[a].status) - STATUS_ORDER.indexOf(appl[b].status))
      .forEach((k) => {
        const r = REGS[k], a = appl[k];
        const li = el("li", {}, chip(a.status), document.createTextNode(" "), link(r.name, r.sources[0].url));
        if (a.evidence[0]) li.append(el("div", { class: "caveat", text: "Why: " + a.evidence[0] }));
        rl.append(li);
      });
    wrap.append(el("b", { class: "sub", text: "Regulations: do they apply to this site?" }), rl);
  }
  if (m.a11yRegs) wrap.append(el("div", { class: "caveat", text: "Accessibility laws mostly point to WCAG 2.1 AA. This is general information, not legal advice." }));
  const ctx = pageContextNote(c, profile);
  if (ctx) wrap.append(el("div", { class: "note-inline ctx", text: ctx }));
  if (m.note) wrap.append(el("div", { class: "note-inline", text: m.note }));
  return wrap;
}

function renderIssue(c, appl, profile) {
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
  body.append(renderRefs(c, appl, profile));
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
  const box = el("div", {});
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
    body.append(el("p", {}, el("b", { text: l.verdict === "unmeasured" ? "Why we can't measure it" : "What we measured" }), ev));
    if (l.verdict !== "unmeasured") body.append(el("p", {}, el("b", { text: "How we judged it" }), document.createTextNode(l.how)));
    if (l.fix && (l.verdict === "not" || l.verdict === "partly")) body.append(el("p", {}, el("b", { text: "How to improve" }), document.createTextNode(l.fix)));
    body.append(el("p", {}, el("b", { text: "What the law says" }), document.createTextNode(l.summary + " "), link(`${l.source || "Source"}`, l.url)));
    if (l.caveat) body.append(el("p", { class: "caveat", text: "Caution: " + l.caveat }));
    box.append(el("details", {},
      el("summary", {},
        el("span", { class: `vd ${l.verdict}`, text: VERDICT_LABEL[l.verdict] }),
        el("span", { text: l.name }),
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
    `Worked out from signals on this page (domain, currency, shop features, forms). Law research dated ${VERIFIED_ON}. ` +
    "A web page can't reveal where a business is based or who its customers are, so check the 'To confirm' items. General information, not legal advice." }));

  Object.keys(appl)
    .sort((a, b) => STATUS_ORDER.indexOf(appl[a].status) - STATUS_ORDER.indexOf(appl[b].status))
    .forEach((id) => {
      const r = REGS[id], a = appl[id];
      const body = el("div", { class: "body" });

      body.append(el("p", {}, el("b", { text: "Why this verdict (evidence on this page)" }),
        (() => { const ul = el("ul"); a.evidence.forEach((e) => ul.append(el("li", { text: e }))); return ul; })()));

      // How does the page actually do against this rule?
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

const scoreColor = (s) => (s >= 80 ? "var(--pass)" : s >= 60 ? "var(--medium)" : "var(--high)");

function render(result) {
  const root = $("report");
  root.replaceChildren();

  const profile = result.profile;
  const appl = assessApplicability(profile, result.checks);
  const laws = assessUxLaws(result.ux, profile, result.checks);

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

  // What we figured out about the site
  const about = describeProfile(profile);
  root.append(el("div", { class: "about" },
    el("b", { text: "About this site (detected)" }),
    el("div", { text: about.length ? about.join(" · ") : "Not enough signals to classify this page." })));

  const lc = (v) => laws.filter((l) => l.verdict === v).length;
  root.append(el("div", { class: "about" },
    el("b", { text: "UX laws at a glance" }),
    el("div", { text: `${lc("followed")} followed · ${lc("partly")} partly · ${lc("not")} not followed (details below)` })));

  const order = { high: 0, medium: 1, low: 2 };
  const failed = result.checks.filter((c) => c.status === "fail").sort((a, b) => order[a.severity] - order[b.severity]);
  const passed = result.checks.filter((c) => c.status === "pass");

  root.append(el("h2", { text: `Needs attention (${failed.length})` }));
  if (failed.length) failed.forEach((c) => root.append(renderIssue(c, appl, profile)));
  else root.append(el("div", { text: "No issues found by the automatic checks. Nice work!" }));

  root.append(el("h2", { text: `Done right (${passed.length})` }));
  const ul = el("ul", { class: "pass-list" });
  passed.forEach((c) => ul.append(el("li", { text: c.title })));
  root.append(ul);

  root.append(renderUxLaws(laws));
  root.append(renderApplicability(appl));

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
