// REPORT PAGE: shows one saved audit as a complete document.
// Reads the record from this device's storage (nothing is fetched online),
// so it always shows exactly what was found on the day.
// Everything is built with textContent, never innerHTML.

const VERDICT_LABEL = { followed: "Followed", partly: "Partly followed", not: "Not followed", na: "Not enough to judge", unmeasured: "Needs human / AI review" };
const STATUS_LABEL = { likely: "Likely applies", may: "May apply", pending: "Proposed, not law yet", unknown: "Can't tell", unlikely: "Probably doesn't apply", info: "For information" };
const SEV = { high: 0, medium: 1, low: 2 };

const fmtDate = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
const scoreColor = (s) => (s >= 80 ? "var(--pass)" : s >= 60 ? "var(--medium)" : "var(--high)");
const vchip = (v) => el("span", { class: `chip vd ${v}`, text: VERDICT_LABEL[v] || v });
const schip = (s) => el("span", { class: `chip st ${s}`, text: STATUS_LABEL[s] || s });
const list = (items) => { const ul = el("ul"); items.forEach((t) => ul.append(el("li", { text: t }))); return ul; };
const labelled = (label, content) => el("p", {}, el("span", { class: "lbl", text: label }), typeof content === "string" ? document.createTextNode(content) : content);

// ---------- sections ----------
function header(a) {
  const root = el("div", {});
  root.append(
    el("h1", { text: "UX Audit Report" }),
    el("div", { class: "site-title", text: a.title || "(untitled page)" }),
    el("div", { class: "meta", text: a.url }),
    el("div", { class: "meta", text: `Audited ${fmtDate(a.ts)} · UX Audit Buddy ${a.extVersion || ""}` }),
  );

  const score = el("div", { class: "score", text: String(a.score) }, el("small", { text: "/ 100" }));
  score.style.setProperty("--c", scoreColor(a.score));
  const sev = { high: 0, medium: 0, low: 0 };
  a.checks.filter((c) => c.status === "fail").forEach((c) => sev[c.severity]++);
  const lc = (v) => a.laws.filter((l) => l.verdict === v).length;

  const bars = el("div", { class: "bars" });
  Object.entries(a.categoryScores).forEach(([name, s]) => {
    const fill = el("div", { class: "fill" });
    fill.style.width = s + "%";
    fill.style.setProperty("--c", scoreColor(s));
    bars.append(el("div", { class: "bar" }, el("span", { text: name }), el("div", { class: "track" }, fill), el("span", { text: String(s) })));
  });

  root.append(el("div", { class: "hero" }, score, el("div", { class: "facts" },
    el("div", { class: "big", text: `${a.summary.failed} issues found · ${a.summary.passed} checks passed` }),
    el("div", { class: "small", text: `${sev.high} high · ${sev.medium} medium · ${sev.low} low severity` }),
    el("div", { class: "small", text: `UX laws: ${lc("followed")} followed · ${lc("partly")} partly · ${lc("not")} not followed · ${lc("unmeasured")} unmeasured` }),
    el("div", { class: "small", text: a.ai ? "Includes an AI review (clearly labelled below)." : "No AI review included." }),
    bars)));
  return root;
}

function takeaways(a) {
  const root = el("div", {});
  root.append(el("h2", { text: "Key takeaways" }));
  const failed = a.checks.filter((c) => c.status === "fail").sort((x, y) => SEV[x.severity] - SEV[y.severity]);
  if (a.ai && a.ai.review.priorities.length) {
    root.append(el("h3", { text: "Top priorities (AI judgment)" }), (() => { const ol = el("ol"); a.ai.review.priorities.forEach((p) => ol.append(el("li", { text: p }))); return ol; })());
  }
  root.append(el("h3", { text: "Most serious issues found by the automatic checks" }));
  root.append(failed.length ? list(failed.slice(0, 5).map((c) => `[${c.severity.toUpperCase()}] ${c.title} (${c.count})`)) : el("p", { text: "No issues were found by the automatic checks." }));
  if (a.profileLines.length) root.append(el("div", { class: "box" }, el("b", { text: "About this site (detected)" }), el("div", { text: a.profileLines.join(" · ") })));
  return root;
}

function issues(a) {
  const root = el("div", {});
  const failed = a.checks.filter((c) => c.status === "fail").sort((x, y) => SEV[x.severity] - SEV[y.severity]);
  root.append(el("h2", { text: `Issues to fix (${failed.length})` }));
  if (!failed.length) root.append(el("p", { text: "No issues were found by the automatic checks." }));
  failed.forEach((c) => {
    const card = el("div", { class: "card" },
      el("div", { class: "head" }, el("span", { class: `badge ${c.severity}`, text: c.severity }), el("span", { class: "title", text: c.title }), el("span", { class: "count", text: `${c.count} found` })),
      labelled("Why it matters", c.why),
      labelled("How to fix", c.fix));
    if (c.examples.length) {
      const ex = list(c.examples);
      if (c.count > c.examples.length) ex.append(el("li", { text: `…and ${c.count - c.examples.length} more` }));
      card.append(labelled("Found on this page", ex));
    }
    const laws = c.uxLawIds.map((id) => a.laws.find((l) => l.id === id)).filter(Boolean);
    if (laws.length) {
      const ul = el("ul");
      laws.forEach((l) => ul.append(el("li", {}, vchip(l.verdict), document.createTextNode(` ${l.name}` + (l.evidence[0] ? `: ${l.evidence[0]}` : "")))));
      card.append(labelled("Related UX laws", ul));
    }
    if (c.wcag.length) card.append(labelled("Accessibility standard", list(c.wcag.map((w) => `${w.name}: ${w.summary}`))));
    if (c.context) card.append(el("div", { class: "note ctx", text: c.context }));
    if (c.note) card.append(el("div", { class: "note", text: c.note }));
    if (c.pointsToRegs) card.append(el("div", { class: "small", text: "Which laws and regulations apply to this site is covered in the rules section below." }));
    root.append(card);
  });

  const passed = a.checks.filter((c) => c.status === "pass");
  root.append(el("h2", { text: `Done right (${passed.length})` }), (() => { const ul = el("ul", { class: "passlist" }); passed.forEach((c) => ul.append(el("li", { text: c.title }))); return ul; })());
  return root;
}

function laws(a) {
  const root = el("div", {});
  root.append(el("h2", { text: "UX laws & heuristics scorecard" }));
  root.append(el("p", { class: "small", text: "UX laws are psychology principles, not legal rules. Each verdict is a measurable stand-in (a proxy), and the cut-offs are rules of thumb explained in each entry. They don't affect the score." }));
  a.laws.forEach((l) => {
    const card = el("div", { class: "card" }, el("div", { class: "head" }, vchip(l.verdict), el("span", { class: "title", text: l.name }),
      l.ai ? el("span", { class: "aitag", text: "AI" }) : null, l.partial ? el("span", { class: "count", text: "partial measurement" }) : null));
    card.append(labelled(l.verdict === "unmeasured" ? "Why it can't be measured" : l.ai ? "What the AI saw" : "What was measured", list(l.evidence)));
    if (l.verdict !== "unmeasured") card.append(labelled("How it was judged", l.how));
    if (l.fix && (l.verdict === "not" || l.verdict === "partly")) card.append(labelled("How to improve", l.fix));
    card.append(labelled("What the law says", l.summary));
    if (l.caveat) card.append(el("div", { class: "note", text: "Caution: " + l.caveat }));
    card.append(el("div", { class: "url", text: `${l.source}: ${l.url}` }));
    root.append(card);
  });
  return root;
}

function aiReview(a) {
  const root = el("div", {});
  root.append(el("h2", { text: "AI review" }));
  if (!a.ai) {
    root.append(el("p", { class: "small", text: "No AI review was run for this audit." }));
    return root;
  }
  const ai = a.ai.review;
  root.append(el("div", { class: "banner warn", text:
    `AI-generated by Claude${a.ai.servedBy ? " (" + a.ai.servedBy + ")" : ""}. It can be wrong, so check it against the page. ` +
    (a.ai.screenshotSent ? "A screenshot of the first screen was included." : "No screenshot was included, so visual judgments are limited.") }));
  root.append(el("p", { text: ai.summary }));

  const usp = ai.usp, clarity = { clear: "Clear", somewhat_clear: "Somewhat clear", unclear: "Unclear" }[usp.clarity];
  const uspCard = el("div", { class: "card" }, el("div", { class: "head" }, el("span", { class: "badge", text: "USP" }), el("span", { class: "title", text: "What this page promises" })),
    el("p", { class: "usp", text: usp.statement }),
    labelled("How clearly the page communicates it", `${clarity} (AI confidence: ${usp.confidence})`));
  if (usp.evidence.length) uspCard.append(labelled("Evidence on the page", list(usp.evidence)));
  if (usp.improvement) uspCard.append(labelled("How to sharpen it", usp.improvement));
  root.append(uspCard);

  root.append(el("h3", { text: `What works (${ai.strengths.length})` }));
  ai.strengths.forEach((s) => root.append(el("div", { class: "card" }, el("div", { class: "head" }, el("span", { class: "chip vd followed", text: "Works" }), el("span", { class: "title", text: s.title })), el("p", { text: s.detail }))));
  root.append(el("h3", { text: `What doesn't (${ai.weaknesses.length})` }));
  ai.weaknesses.forEach((w) => root.append(el("div", { class: "card" }, el("div", { class: "head" }, el("span", { class: `badge ${w.severity}`, text: w.severity }), el("span", { class: "title", text: w.title })), labelled("What's wrong", w.detail), labelled("How to fix", w.fix))));
  if (ai.limitations) root.append(el("div", { class: "note", text: "What the AI couldn't judge: " + ai.limitations }));
  return root;
}

function regulations(a) {
  const root = el("div", {});
  const ORDER = ["likely", "may", "pending", "unknown", "unlikely", "info"];
  root.append(el("h2", { text: "Which rules apply to this site?" }));
  root.append(el("p", { class: "small", text:
    `Worked out from signals on the page (domain, currency, shop features, forms). Law research dated ${a.lawsResearchDate || "unknown"}; laws change quickly. ` +
    "A web page can't reveal where a business is based or who its customers are, so check the 'To confirm' items. General information, not legal advice." }));
  a.regs.slice().sort((x, y) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict)).forEach((r) => {
    const card = el("div", { class: "card" },
      el("div", { class: "head" }, schip(r.verdict), el("span", { class: "title", text: r.name }), el("span", { class: "count", text: r.region })),
      labelled("Why this verdict (evidence on this page)", list(r.evidence)));
    if (r.page.total) {
      card.append(labelled("What this page shows", r.page.failed.length
        ? `${r.page.failed.length} of ${r.page.total} related automatic checks are failing: ${r.page.failed.join("; ")}.`
        : `All ${r.page.total} related automatic checks passed. Only part of this can be tested automatically, so this doesn't prove compliance.`));
    } else if (r.verdict !== "info") card.append(labelled("What this page shows", "No automatic check covers this rule yet."));
    if (r.confirm.length) card.append(labelled("To confirm yourself", list(r.confirm)));
    card.append(labelled("About the rule", `${r.ruleStatus}. ${r.summary}`));
    if (r.caveat) card.append(el("div", { class: "note", text: "Caution: " + r.caveat }));
    card.append(labelled("Sources", (() => { const ul = el("ul"); r.sources.forEach((s) => ul.append(el("li", {}, link(s.label, s.url), el("div", { class: "url", text: s.url })))); return ul; })()));
    root.append(card);
  });
  return root;
}

function method(a) {
  const root = el("div", {});
  root.append(el("h2", { text: "How to read this report" }));
  root.append(list([
    `${a.checks.length} automatic rule-based checks were run on the page as it was when scanned. They are a first pass, not a full audit, and they can't replace expert review or testing with real users.`,
    "Thresholds (such as 24px targets or 120-word paragraphs) are rules of thumb, explained next to each result. A UX law verdict is a measurable stand-in for a psychological principle, not a proof.",
    "Findings reflect one visit on one device and screen size. Content behind logins, pop-ups or interactions may not have been seen.",
    `Law and regulation notes were researched via web search on ${a.lawsResearchDate || "an unrecorded date"}. Laws change; check current sources before acting. This is general information, not legal advice.`,
    a.ai ? "The AI review is an opinion generated by a language model from the page text" + (a.ai.screenshotSent ? " and a screenshot" : "") + ". It can be wrong and is labelled wherever it appears." : "No AI review was included in this audit.",
    "This report is stored on the device where it was made. The page address is saved without its query string or #fragment, but the report may still contain text from the audited page; share it with care.",
  ]));
  root.append(el("footer", { class: "doc", text: `Generated by UX Audit Buddy ${a.extVersion || ""} on ${fmtDate(a.ts)}.` }));
  return root;
}

// ---------- page ----------
function renderReport(a) {
  const report = el("article", { class: "report", id: "report" });
  report.append(header(a), takeaways(a), issues(a), laws(a), aiReview(a), regulations(a), method(a));
  return report;
}

const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "page";
function fileBase(a) {
  let host = "page";
  try { host = new URL(a.url).hostname; } catch (e) { /* keep default */ }
  return `ux-audit_${safeName(host)}_${new Date(a.ts).toISOString().slice(0, 10)}`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// A single self-contained .html file: inlined CSS, no scripts, works offline.
async function standaloneHtml(a) {
  const css = await (await fetch(chrome.runtime.getURL("report.css"))).text();
  const body = document.getElementById("report").outerHTML;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${(a.title || "UX Audit Report").replace(/[<&>]/g, " ")} - UX Audit Report</title><style>${css}</style></head>` +
    `<body style="background:#fafafa"><main>${body}</main></body></html>`;
}

async function main() {
  const root = document.getElementById("root");
  const id = new URLSearchParams(location.search).get("id");
  const a = id ? await AuditStore.getAudit(id) : null;
  if (!a) {
    root.replaceChildren(el("p", { class: "empty", text: "This report wasn't found on this device. It may have been deleted. Open the History page to see saved audits." }));
    document.getElementById("toolbar").querySelectorAll("button").forEach((b) => (b.disabled = true));
    return;
  }
  document.title = `UX Audit Report - ${a.title || a.url}`;
  root.replaceChildren(renderReport(a));
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("btn-json").addEventListener("click", () => download(fileBase(a) + ".json", JSON.stringify(a, null, 2), "application/json"));
  document.getElementById("btn-html").addEventListener("click", async () => download(fileBase(a) + ".html", await standaloneHtml(a), "text/html"));
}
main();
