// REPORT DOCUMENT MODEL: turns one saved audit record into simple "blocks" that the
// PDF writer (lib/pdf.js) can lay out. It mirrors lib/report-render.js (the HTML version),
// so the Summary and Full PDFs say the same things as the on-screen reports.
// Pure data in, pure data out: no DOM, no network.

const ReportDoc = (() => {
  const VERDICT_LABEL = { followed: "Followed", partly: "Partly followed", not: "Not followed", na: "Not enough to judge", unmeasured: "Needs human / AI review" };
  const STATUS_LABEL = { likely: "Likely applies", may: "May apply", pending: "Proposed, not law yet", unknown: "Can't tell", unlikely: "Probably doesn't apply", info: "For information" };
  const SEV = { high: 0, medium: 1, low: 2 };
  const REG_ORDER = ["likely", "may", "pending", "unknown", "unlikely", "info"];

  const fmtDate = (ts) => new Date(ts).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const failedChecks = (a) => a.checks.filter((c) => c.status === "fail").sort((x, y) => SEV[x.severity] - SEV[y.severity]);

  function head(a, heading) {
    const sev = { high: 0, medium: 0, low: 0 };
    a.checks.filter((c) => c.status === "fail").forEach((c) => sev[c.severity]++);
    const lc = (v) => a.laws.filter((l) => l.verdict === v).length;
    return [
      { t: "title", text: heading, site: a.title || "(untitled page)", lines: [a.url, `Audited ${fmtDate(a.ts)} · UX Audit Buddy ${a.extVersion || ""}`.trim()] },
      {
        t: "hero", score: a.score,
        facts: [
          { text: `${a.summary.failed} issues found · ${a.summary.passed} checks passed`, bold: true },
          { text: `${sev.high} high · ${sev.medium} medium · ${sev.low} low severity` },
          { text: `UX laws: ${lc("followed")} followed · ${lc("partly")} partly · ${lc("not")} not followed · ${lc("unmeasured")} unmeasured` },
          ...(a.ai ? [{ text: "Includes an AI review (clearly labelled)." }] : []),
        ],
        bars: Object.entries(a.categoryScores).map(([name, score]) => ({ name, score })),
      },
    ];
  }

  function summary(a) {
    const b = head(a, "UX Audit Summary");
    b.push({ t: "note", text: "Summary version. The full report has every issue, law, regulation and source in detail." });

    const failed = failedChecks(a);
    b.push({ t: "h2", text: `Top issues to fix (${Math.min(5, failed.length)} of ${failed.length})` });
    if (!failed.length) b.push({ t: "p", text: "No issues were found by the automatic checks." });
    failed.slice(0, 5).forEach((c) => b.push({ t: "issue", sev: c.severity, title: c.title, count: `${c.count} found`, fields: [{ label: "How to fix", text: clip(c.fix, 170) }] }));

    b.push({ t: "h2", text: "UX laws at a glance" });
    [["not", "Not followed"], ["partly", "Partly followed"], ["followed", "Followed"]].forEach(([v, label]) => {
      const names = a.laws.filter((l) => l.verdict === v).map((l) => l.name.replace("Nielsen heuristic: ", "Nielsen: "));
      if (names.length) b.push({ t: "lawrow", pill: label, tone: v, names: names.slice(0, 10) });
    });
    const un = a.laws.filter((l) => l.verdict === "unmeasured").length;
    if (un) b.push({ t: "p", text: `${un} more law${un === 1 ? "" : "s"} can't be judged from code and need human or AI review.`, size: 8.5, color: "faint" });

    if (a.ai) {
      const ai = a.ai.review, clarity = { clear: "Clear", somewhat_clear: "Somewhat clear", unclear: "Unclear" }[ai.usp.clarity] || "";
      b.push({ t: "h2", text: "AI review (AI-generated, can be wrong)" }, { t: "usp", text: ai.usp.statement },
        { t: "p", text: `How clearly the page communicates it: ${clarity}.`, size: 8.5, color: "faint" },
        { t: "p", text: clip(ai.summary, 380) });
      if (ai.priorities.length) b.push({ t: "h3", text: "AI's top priorities" }, { t: "bullets", numbered: true, items: ai.priorities.slice(0, 3).map((p) => clip(p, 160)) });
    }

    b.push({ t: "h2", text: "Rules that may apply to this site" });
    const relevant = a.regs.filter((r) => ["likely", "may", "pending"].includes(r.verdict)).sort((x, y) => REG_ORDER.indexOf(x.verdict) - REG_ORDER.indexOf(y.verdict));
    if (relevant.length) {
      relevant.slice(0, 6).forEach((r) => b.push({ t: "regrow", pill: STATUS_LABEL[r.verdict], tone: r.verdict, text: `${r.name} (${r.region})` }));
      if (relevant.length > 6) b.push({ t: "p", text: `…and ${relevant.length - 6} more in the full report.`, size: 8.5, color: "faint" });
    } else b.push({ t: "p", text: "None of the rules in our list clearly apply, based on what the page shows." });
    b.push({ t: "p", size: 8.5, color: "faint", text: `Worked out from signals on the page and researched ${a.lawsResearchDate || "on an unrecorded date"}. A web page can't show where a business is based or who its customers are, so verify each one. General information, not legal advice.` });

    b.push({ t: "h3", text: "Read this first" }, {
      t: "bullets", size: 8.8, items: [
        `${a.checks.length} automatic checks ran on one visit. They are a first pass, not a full audit or a substitute for testing with real users.`,
        "UX law verdicts are measurable stand-ins (proxies) with rules-of-thumb cut-offs; they are not proofs.",
        ...(a.ai ? ["AI-generated parts are labelled and can be wrong."] : []),
      ],
    });
    return b;
  }

  function full(a) {
    const b = head(a, "UX Audit Report");
    const failed = failedChecks(a);

    // Key takeaways
    b.push({ t: "h2", text: "Key takeaways" });
    if (a.ai && a.ai.review.priorities.length) b.push({ t: "h3", text: "Top priorities (AI judgment)" }, { t: "bullets", numbered: true, items: a.ai.review.priorities });
    b.push({ t: "h3", text: "Most serious issues found by the automatic checks" });
    if (failed.length) b.push({ t: "bullets", items: failed.slice(0, 5).map((c) => `[${c.severity.toUpperCase()}] ${c.title} (${c.count})`) });
    else b.push({ t: "p", text: "No issues were found by the automatic checks." });
    if (a.profileLines.length) b.push({ t: "note", text: "About this site (detected): " + a.profileLines.join(" · ") });

    // Issues
    b.push({ t: "h2", text: `Issues to fix (${failed.length})` });
    if (!failed.length) b.push({ t: "p", text: "No issues were found by the automatic checks." });
    failed.forEach((c) => {
      const fields = [{ label: "Why it matters", text: c.why }, { label: "How to fix", text: c.fix }];
      if (c.examples.length) fields.push({ label: "Found on this page", items: [...c.examples, ...(c.count > c.examples.length ? [`…and ${c.count - c.examples.length} more`] : [])] });
      const laws = c.uxLawIds.map((id) => a.laws.find((l) => l.id === id)).filter(Boolean);
      if (laws.length) fields.push({ label: "Related UX laws", items: laws.map((l) => `${VERDICT_LABEL[l.verdict]}: ${l.name}` + (l.evidence[0] ? ` - ${l.evidence[0]}` : "")) });
      if (c.wcag.length) fields.push({ label: "Accessibility standard", items: c.wcag.map((w) => `${w.name}: ${w.summary}`) });
      const note = [c.context, c.note, c.pointsToRegs ? "Which laws and regulations apply to this site is covered in the rules section below." : ""].filter(Boolean).join(" ");
      b.push({ t: "issue", sev: c.severity, title: c.title, count: `${c.count} found`, fields, note: note ? { text: note } : null });
    });

    const passed = a.checks.filter((c) => c.status === "pass");
    b.push({ t: "h2", text: `Done right (${passed.length})` }, { t: "ticks", items: passed.map((c) => c.title) });

    // UX laws
    b.push({ t: "h2", text: "UX laws & heuristics scorecard" },
      { t: "p", size: 8.5, color: "faint", text: "UX laws are psychology principles, not legal rules. Each verdict is a measurable stand-in (a proxy), and the cut-offs are rules of thumb explained in each entry. They don't affect the score." });
    a.laws.forEach((l) => {
      const fields = [{ label: l.verdict === "unmeasured" ? "Why it can't be measured" : l.ai ? "What the AI saw" : "What was measured", items: l.evidence }];
      if (l.verdict !== "unmeasured") fields.push({ label: "How it was judged", text: l.how });
      if (l.fix && (l.verdict === "not" || l.verdict === "partly")) fields.push({ label: "How to improve", text: l.fix });
      fields.push({ label: "What the law says", text: l.summary });
      fields.push({ label: "Source", links: [{ label: l.source, url: l.url }] });
      b.push({ t: "law", label: VERDICT_LABEL[l.verdict] || l.verdict, verdict: l.verdict, name: l.name, tag: l.partial ? "partial measurement" : l.ai ? "AI" : "", fields, note: l.caveat ? "Caution: " + l.caveat : "" });
    });

    // AI review (only if present)
    if (a.ai) {
      const ai = a.ai.review, clarity = { clear: "Clear", somewhat_clear: "Somewhat clear", unclear: "Unclear" }[ai.usp.clarity] || "";
      b.push({ t: "h2", text: "AI review" },
        { t: "note", tone: "warn", text: `AI-generated${a.ai.servedBy ? " (" + a.ai.servedBy + ")" : ""}. It can be wrong, so check it against the page.` },
        { t: "p", text: ai.summary }, { t: "h3", text: "What this page promises" }, { t: "usp", text: ai.usp.statement },
        { t: "p", text: `How clearly the page communicates it: ${clarity} (AI confidence: ${ai.usp.confidence}).`, size: 8.5, color: "faint" });
      if (ai.usp.evidence.length) b.push({ t: "bullets", items: ai.usp.evidence });
      if (ai.usp.improvement) b.push({ t: "p", text: "How to sharpen it: " + ai.usp.improvement });
      b.push({ t: "h3", text: `What works (${ai.strengths.length})` });
      ai.strengths.forEach((s) => b.push({ t: "law", label: "Works", verdict: "followed", name: s.title, tag: "", fields: [{ label: "Detail", text: s.detail }] }));
      b.push({ t: "h3", text: `What doesn't (${ai.weaknesses.length})` });
      ai.weaknesses.forEach((w) => b.push({ t: "issue", sev: w.severity, title: w.title, count: "", fields: [{ label: "What's wrong", text: w.detail }, { label: "How to fix", text: w.fix }] }));
      if (ai.limitations) b.push({ t: "note", text: "What the AI couldn't judge: " + ai.limitations });
    }

    // Regulations
    b.push({ t: "h2", text: "Which rules apply to this site?" },
      { t: "p", size: 8.5, color: "faint", text: `Worked out from signals on the page (domain, currency, shop features, forms). Law research dated ${a.lawsResearchDate || "unknown"}; laws change quickly. A web page can't reveal where a business is based or who its customers are, so check the 'To confirm' items. General information, not legal advice.` });
    a.regs.slice().sort((x, y) => REG_ORDER.indexOf(x.verdict) - REG_ORDER.indexOf(y.verdict)).forEach((r) => {
      const fields = [{ label: "Why this verdict (evidence on this page)", items: r.evidence }];
      if (r.page.total) fields.push({ label: "What this page shows", text: r.page.failed.length ? `${r.page.failed.length} of ${r.page.total} related automatic checks are failing: ${r.page.failed.join("; ")}.` : `All ${r.page.total} related automatic checks passed. Only part of this can be tested automatically, so this doesn't prove compliance.` });
      else if (r.verdict !== "info") fields.push({ label: "What this page shows", text: "No automatic check covers this rule yet." });
      if (r.confirm.length) fields.push({ label: "To confirm yourself", items: r.confirm });
      fields.push({ label: "About the rule", text: `${r.ruleStatus}. ${r.summary}` });
      fields.push({ label: "Sources", links: r.sources.map((s) => ({ label: s.label, url: s.url })) });
      b.push({ t: "reg", label: STATUS_LABEL[r.verdict] || r.verdict, verdict: r.verdict, name: r.name, region: r.region, fields, note: r.caveat ? "Caution: " + r.caveat : "" });
    });

    // Method
    b.push({ t: "h2", text: "How to read this report" }, {
      t: "bullets", items: [
        `${a.checks.length} automatic rule-based checks were run on the page as it was when scanned. They are a first pass, not a full audit, and they can't replace expert review or testing with real users.`,
        "Thresholds (such as 24px targets or 120-word paragraphs) are rules of thumb, explained next to each result. A UX law verdict is a measurable stand-in for a psychological principle, not a proof.",
        "Findings reflect one visit on one device and screen size. Content behind logins, pop-ups or interactions may not have been seen.",
        `Law and regulation notes were researched via web search on ${a.lawsResearchDate || "an unrecorded date"}. Laws change; check current sources before acting. This is general information, not legal advice.`,
        ...(a.ai ? ["The AI review is an opinion generated by a language model. It can be wrong and is labelled wherever it appears."] : []),
        "This report is stored on the device where it was made. The page address is saved without its query string or #fragment, but the report may still contain text from the audited page; share it with care.",
      ],
    });
    return b;
  }

  function hostOf(a) { try { return new URL(a.url).hostname.replace(/^www\./, ""); } catch { return "page"; } }

  // view: "summary" | "full"  ->  { title, footer, ts, blocks }
  function build(a, view) {
    return {
      title: `${view === "summary" ? "UX Audit Summary" : "UX Audit Report"} - ${a.title || hostOf(a)}`,
      footer: `UX Audit Buddy ${view === "summary" ? "summary" : "report"} · ${hostOf(a)} · ${new Date(a.ts).toLocaleDateString("en-GB")}`,
      ts: a.ts,
      blocks: view === "summary" ? summary(a) : full(a),
    };
  }

  return { build };
})();
