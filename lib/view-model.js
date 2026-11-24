// VIEW MODEL: turns a saved-audit record into what the side panel shows.
// Pure functions (no DOM, no storage) so they can be tested on their own.

const SEV_LABEL = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const SEV_PILL = { high: "p-high", medium: "p-med", low: "p-low" };

// Colours for scores (the same bands everywhere).
const scoreInk = (v) => (v < 50 ? "#B42318" : v < 80 ? "#B54708" : "#067647");
const scoreFill = (v) => (v < 50 ? "#F04438" : v < 80 ? "#F79009" : "#17B26A");

function scoreVerdict(score) {
  if (score >= 85) return { label: "Looking good", ink: "#067647" };
  if (score >= 70) return { label: "Good, with gaps", ink: "#B54708" };
  if (score >= 50) return { label: "Needs work", ink: "#B54708" };
  return { label: "Needs attention", ink: "#B42318" };
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinNames = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

// "Accessibility and readability are pulling the score down."
function weakSentence(rec) {
  const weak = Object.entries(rec.categoryScores).filter(([, v]) => v < 80).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k]) => k);
  if (!weak.length) return "No area scores below 80.";
  const names = weak.map((n, i) => (i === 0 ? n : lowerFirst(n)));
  return `${joinNames(names)} ${weak.length === 1 ? "is" : "are"} pulling the score down.`;
}

const failedChecks = (rec) => rec.checks.filter((c) => c.status === "fail").sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
const passedChecks = (rec) => rec.checks.filter((c) => c.status === "pass");

// "Fix these first": up to 3, most serious first.
const topFixes = (rec) => failedChecks(rec).slice(0, 3);

// Score by area: weakest first; those at 100 are summarised in one line.
function areaBars(rec) {
  const all = Object.entries(rec.categoryScores).sort((a, b) => a[1] - b[1]);
  return { bars: all.filter(([, v]) => v < 100), perfect: all.filter(([, v]) => v >= 100).map(([k]) => k) };
}

const REGION_NAME = { IN: "India", EU: "EU", US: "US", UK: "UK" };
const PAGE_KIND = { checkout: "Checkout page", cart: "Cart page", login: "Login page", home: "Home page", other: "Page" };

// What the page card shows under the title.
function pageSub(rec) {
  let host = "";
  try { host = new URL(rec.url).hostname.replace(/^www\./, ""); } catch (e) { host = rec.url; }
  const kind = rec.profile && rec.profile.pageKind ? PAGE_KIND[rec.profile.pageKind] : "";
  return kind && kind !== "Page" ? `${host} · ${kind}` : host;
}

// Rules, grouped the way the design shows them.
const RULE_GROUPS = [
  { key: "may", label: "May apply", pill: "p-may", verdicts: ["likely", "may"], open: true },
  { key: "know", label: "Worth knowing", pill: "p-prop", verdicts: ["pending", "info"], open: false },
  { key: "cant", label: "Can't tell", pill: "p-cant", verdicts: ["unknown"], open: false },
  { key: "no", label: "Probably doesn't apply", pill: "p-no", verdicts: ["unlikely"], open: false },
];
const groupRules = (rec) => RULE_GROUPS.map((g) => ({ ...g, items: rec.regs.filter((r) => g.verdicts.includes(r.verdict)) }));
const mayApplyCount = (rec) => rec.regs.filter((r) => ["likely", "may"].includes(r.verdict)).length;

// Rules tab "Based on" chips.
function ruleBasis(rec) {
  const p = rec.profile || {};
  const chips = [];
  const regions = (p.regions || []).map((c) => REGION_NAME[c] || c);
  chips.push(regions.length ? `${joinNames(regions)} signals` : "No region signals");
  if (p.pageKind && PAGE_KIND[p.pageKind] && p.pageKind !== "other") chips.push(PAGE_KIND[p.pageKind]);
  for (const f of p.flags || []) chips.push(f);
  return chips;
}

// UX laws, grouped by verdict (worst first). Laws the AI judged get their own group.
const LAW_VERDICT_PILL = { not: ["Not followed", "p-not"], partly: ["Partly", "p-partly"], followed: ["Followed", "p-ok"], na: ["Can't judge", "p-cant"], unmeasured: ["Needs AI review", "p-rev"] };
const shortLawName = (n) => n.replace(/^Nielsen heuristic: /, "");

function groupLaws(rec) {
  const laws = rec.laws;
  const ai = laws.filter((l) => l.ai);
  const rest = laws.filter((l) => !l.ai);
  const by = (v) => rest.filter((l) => l.verdict === v);
  const groups = [
    { key: "not", label: "Not followed", pill: "p-not", items: by("not"), open: true },
    { key: "partly", label: "Partly followed", pill: "p-partly", items: by("partly"), open: false },
  ];
  if (ai.length) groups.push({ key: "ai", label: "Judged by AI", pill: "p-rev", items: ai, open: false, ai: true });
  else if (by("unmeasured").length) groups.push({ key: "rev", label: "Needs AI review", pill: "p-rev", items: by("unmeasured"), open: false, review: true });
  groups.push({ key: "ok", label: "Followed", pill: "p-ok", items: by("followed"), open: false });
  groups.push({ key: "cant", label: "Can't judge", pill: "p-cant", items: by("na"), open: false });
  // AI laws the AI couldn't judge stay in "needs AI review"
  const stillOpen = rest.filter((l) => l.verdict === "unmeasured");
  if (ai.length && stillOpen.length) groups.splice(3, 0, { key: "rev", label: "Needs AI review", pill: "p-rev", items: stillOpen, open: false, review: true });
  return groups.filter((g) => g.items.length);
}

function lawCounts(rec) {
  const c = { followed: 0, partly: 0, not: 0, na: 0, unmeasured: 0, ai: 0 };
  for (const l of rec.laws) { if (l.ai) c.ai++; else c[l.verdict]++; }
  return c;
}

// "2h ago", "3 days ago"...
function timeAgo(ts, now = Date.now()) {
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}
