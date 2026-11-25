// AUDIT MODEL: turns a finished scan (+ optional AI review) into a stored
// "audit record", and compares two records.
//
// A record is SELF-CONTAINED: it carries snapshots of the law, standard and
// regulation text it was based on, so an old report still reads exactly as it
// did the day it was made, even after the knowledge base is updated. That is
// what makes reports useful "for future reference".
//
// Pure functions (no storage, no DOM) so they are easy to test.
// Depends on globals: CHECK_REFS, WCAG, REGS, VERIFIED_ON, describeProfile.

const AUDIT_VERSION = 1;
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const VERDICT_RANK = { not: 0, partly: 1, followed: 2 };

// Compare pages by origin + path (ignore ?query, #hash and a trailing slash).
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname.replace(/\/+$/, "");
  } catch (e) { return String(u || ""); }
}

// The address we STORE and SEND to the AI server: origin + path only.
// Query strings and #fragments often carry secrets (reset tokens, session ids),
// so they are dropped.
function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch (e) { return String(u || "").split(/[?#]/)[0]; }
}

function newAuditId() {
  return "a_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
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

// cur = { result, appl, laws, ai, aiShot, savedId, savedTs }
function buildAuditRecord(cur, extVersion) {
  const r = cur.result;
  return {
    v: AUDIT_VERSION,
    id: cur.savedId || newAuditId(),
    ts: cur.savedTs || Date.now(),
    extVersion: extVersion || "",
    url: safeUrl(r.url),
    title: r.title,
    score: r.score,
    categoryScores: r.categoryScores,
    summary: r.summary,
    notice: r.pageNotice ? { kind: r.pageNotice.kind, text: r.pageNotice.text } : null,
    profileLines: describeProfile(r.profile),
    // Structured facts (used by the side panel's Rules tab and page card).
    profile: {
      regions: [...new Set((r.profile.regions || []).map((x) => x.region))],
      pageKind: r.profile.pageKind || "other",
      flags: [
        r.profile.gov && r.profile.gov.is && "Government site",
        r.profile.ecommerce && r.profile.ecommerce.level !== "none" && "Shop features",
        r.profile.subscription && r.profile.subscription.found && "Subscriptions",
        r.profile.platform && r.profile.platform.found && "User content",
        r.profile.data && r.profile.data.collects && "Collects personal data",
      ].filter(Boolean),
    },
    checks: r.checks.map((c) => {
      const m = CHECK_REFS[c.id] || {};
      return {
        id: c.id, category: c.category, title: c.title, severity: c.severity, status: c.status, count: c.count,
        examples: c.examples, why: c.why, fix: c.fix, ref: c.ref,
        uxLawIds: m.uxLaws || [],
        wcag: (m.wcag || []).map((k) => ({ name: WCAG[k].name, summary: WCAG[k].summary, url: WCAG[k].url })),
        note: m.note || "",
        context: pageContextNote(c, r.profile),
        pointsToRegs: !!(m.regs || m.a11yRegs),
      };
    }),
    laws: cur.laws.map((l) => ({
      id: l.id, name: l.name, kind: l.kind, verdict: l.verdict, evidence: l.evidence, how: l.how, fix: l.fix,
      summary: l.summary, url: l.url, source: l.source || "", caveat: l.caveat || "", partial: !!l.partial, ai: !!l.ai,
    })),
    regs: Object.keys(cur.appl).map((id) => {
      const g = REGS[id], a = cur.appl[id];
      return {
        id, name: g.name, region: g.region, ruleStatus: g.status, summary: g.summary, caveat: g.caveat || "", sources: g.sources,
        verdict: a.status, evidence: a.evidence, confirm: a.confirm, page: a.page,
      };
    }),
    // Sample data from the server's mock mode is never stored as a real review.
    ai: cur.ai && !cur.ai.mock
      ? { review: cur.ai.review, servedBy: cur.ai.servedBy || "", screenshotSent: !!(cur.aiShot && cur.aiShot.sent) }
      : null,
    lawsResearchDate: typeof VERIFIED_ON !== "undefined" ? VERIFIED_ON : "",
  };
}

// Small entry kept in the history list (the full record is stored separately).
function indexEntry(rec) {
  return {
    id: rec.id, ts: rec.ts, url: rec.url, title: rec.title, score: rec.score,
    failed: rec.summary.failed, passed: rec.summary.passed, hasAI: !!rec.ai, norm: normalizeUrl(rec.url),
  };
}

// Before-and-after: what got fixed, what broke, what is still wrong.
function compareAudits(a, b) {
  const byId = (rec) => Object.fromEntries(rec.checks.map((c) => [c.id, c]));
  const A = byId(a), B = byId(b);
  const fixed = [], regressed = [], still = [];
  for (const id of Object.keys(B)) {
    if (!A[id]) continue; // check didn't exist in the older audit
    if (A[id].status === "fail" && B[id].status === "pass") fixed.push(B[id].title);
    else if (A[id].status === "pass" && B[id].status === "fail") regressed.push(B[id].title);
    else if (A[id].status === "fail" && B[id].status === "fail") still.push(B[id].title);
  }
  const lawsA = Object.fromEntries(a.laws.map((l) => [l.id, l]));
  const lawChanges = [];
  for (const l of b.laws) {
    const o = lawsA[l.id];
    if (!o || !(o.verdict in VERDICT_RANK) || !(l.verdict in VERDICT_RANK) || o.verdict === l.verdict) continue;
    lawChanges.push({ name: l.name, from: o.verdict, to: l.verdict, improved: VERDICT_RANK[l.verdict] > VERDICT_RANK[o.verdict] });
  }
  return {
    scoreFrom: a.score, scoreTo: b.score, delta: b.score - a.score,
    fixed, regressed, still, lawChanges,
    sameUrl: normalizeUrl(a.url) === normalizeUrl(b.url),
    days: Math.round((b.ts - a.ts) / 86400000),
  };
}
