// APPLICABILITY ENGINE
//
// Takes the facts the scanner collected about a site (its "profile") and the
// check results, and answers for each rule in the knowledge base:
//   * does it probably apply to THIS site? (status + evidence)
//   * what does this page show against it? (related checks passing/failing)
//   * what can't we know from the page? (things the owner must confirm)
//
// It is rule-based and deterministic: same page, same answer, no AI needed.
// It deliberately says "may apply" or "can't tell" when the page can't prove
// the answer. Law usually turns on facts a web page doesn't reveal (where the
// business is based, how big it is, where its customers are).
//
// This is general information, NOT legal advice.
//
// Statuses: likely | may | pending | unlikely | unknown | info
// Depends on globals from references.js: REGS, CHECK_REFS, A11Y_REGS.

const STATUS_ORDER = ["likely", "may", "pending", "unknown", "unlikely", "info"];

function assessApplicability(profile, checks) {
  const p = profile || { regions: [], ecommerce: { level: "none", why: [] }, subscription: {}, platform: {}, data: {}, gov: {} };

  const region = (code) => {
    const hits = p.regions.filter((r) => r.region === code);
    return { has: hits.length > 0, strong: hits.some((r) => r.strength === "strong"), why: hits.map((h) => h.why) };
  };
  const IN = region("IN"), EU = region("EU"), US = region("US");
  const anyRegion = p.regions.length > 0;
  const otherRegionOnly = (code) => anyRegion && !region(code).has;
  const ecom = p.ecommerce.level; // likely | possible | none
  const commerce = ecom !== "none" || p.subscription.found || p.platform.found;

  const out = {};
  const set = (id, status, evidence, confirm) => { out[id] = { status, evidence, confirm: confirm || [] }; };

  // ---- EU Accessibility Act ----
  if (ecom === "likely" && EU.has) {
    set("eaa", "likely", [...p.ecommerce.why.map((w) => "E-commerce: " + w), ...EU.why.map((w) => "EU: " + w)],
      ["Is your business established in the EU, or do you sell to EU customers?", "Check national law for exemptions and penalties that fit your business."]);
  } else if (ecom === "likely") {
    set("eaa", "may", [...p.ecommerce.why.map((w) => "E-commerce: " + w), "No EU signals on this page."],
      ["Do you sell to customers in the EU? One source says non-EU businesses selling to EU customers can be in scope."]);
  } else if (ecom === "possible") {
    set("eaa", "may", [...p.ecommerce.why.map((w) => "Possible e-commerce: " + w), EU.has ? "EU signals found." : "No EU signals on this page."],
      ["Is this a shop that sells to EU customers?"]);
  } else {
    set("eaa", "unknown", ["No e-commerce signals found. Research for this rule focused on e-commerce; it covers other consumer services too."],
      ["Do you offer consumer digital services in the EU (check the Act's list of covered services)?"]);
  }

  // ---- US ADA Title II ----
  if (p.gov.is && p.gov.country === "US") {
    set("ada2", "may", ["The domain looks like a US government site (.gov)."],
      ["Is this a STATE or LOCAL government (the rule's scope), rather than a federal agency?",
       "What population does it serve? 50,000+: 26 Apr 2027. Smaller or special districts: 26 Apr 2028."]);
  } else if (p.gov.is) {
    set("ada2", "unlikely", ["Government site, but not a US one."], []);
  } else {
    set("ada2", "unlikely", ["Not a government site. The rule covers state and local government bodies, not private businesses."],
      ["Are you a US state/local government body, or do you run services on its behalf? (ask a lawyer)"]);
  }

  // ---- India accessibility ----
  if (p.gov.is && p.gov.country === "IN") {
    set("india_a11y", "likely", ["Indian government domain (.gov.in / .nic.in): GIGW 3.0 is aimed at government sites."],
      ["Confirm with your department's web guidelines which GIGW version and WCAG level is required."]);
  } else if (IN.has) {
    set("india_a11y", "may", IN.why.map((w) => "India: " + w),
      ["Sources disagree on how binding accessibility rules are for private sites. Check the RPwD Act, MeitY notifications and a lawyer."]);
  } else if (otherRegionOnly("IN")) {
    set("india_a11y", "unlikely", ["Page signals point to other regions, not India."], ["Is your business based in India or serving Indian users?"]);
  } else {
    set("india_a11y", "unknown", ["No region signals found on this page."], ["Is your business based in India or serving Indian users?"]);
  }

  // ---- India dark patterns ----
  if (IN.has && commerce) {
    set("india_dark", "likely", [...IN.why.map((w) => "India: " + w), ...p.ecommerce.why.map((w) => "Commerce: " + w), ...p.subscription.why.map((w) => "Subscription: " + w), ...p.platform.why.map((w) => "Platform: " + w)],
      ["Sources conflict on whether the guidelines are binding or voluntary; enforcement actions have been reported.", "Confirm whether you sell to Indian consumers."]);
  } else if (IN.has) {
    set("india_dark", "may", IN.why.map((w) => "India: " + w).concat("No commerce signals found."), ["Do you sell goods or services to Indian consumers online?"]);
  } else if (commerce && !anyRegion) {
    set("india_dark", "may", ["Commerce signals found but no region signals."], ["Do you sell to Indian consumers?"]);
  } else if (otherRegionOnly("IN")) {
    set("india_dark", "unlikely", ["Page signals point to other regions."], ["Do you also serve Indian consumers?"]);
  } else {
    set("india_dark", "unknown", ["No region or commerce signals found."], ["Do you sell to Indian consumers?"]);
  }

  // ---- EU DSA Article 25 ----
  if (p.platform.found && EU.has) {
    set("dsa25", "likely", [...p.platform.why.map((w) => "Platform: " + w), ...EU.why.map((w) => "EU: " + w)],
      ["Article 25 targets online PLATFORM providers; confirm you meet that definition."]);
  } else if (p.platform.found) {
    set("dsa25", "may", [...p.platform.why.map((w) => "Platform: " + w), "No EU signals on this page."], ["Do you serve users in the EU, and are you an online platform provider?"]);
  } else if (ecom !== "none") {
    set("dsa25", "unlikely", ["Looks like a single-seller shop. Article 25 targets online platforms (marketplaces, social networks), not ordinary stores."],
      ["Do other sellers or users publish content or offers on your site?"]);
  } else {
    set("dsa25", "unlikely", ["No marketplace or user-content signals found."], []);
  }

  // ---- EU Digital Fairness Act (proposal) ----
  set("dfa", "pending",
    [EU.has || commerce ? "Would matter if adopted: this site has " + [EU.has && "EU signals", commerce && "commerce signals"].filter(Boolean).join(" and ") + "." : "No EU or commerce signals; relevance unclear."],
    ["It is a proposal. Watch the EU legislative process; the text may change."]);

  // ---- California ----
  if (US.has && p.data.collects) {
    set("cppa", "may", [...US.why.map((w) => "US: " + w), "Collects personal data: " + p.data.why.join(", ")],
      ["Do you have California consumers? Do you meet the CCPA business thresholds (not researched here)?"]);
  } else if (otherRegionOnly("US")) {
    set("cppa", "unlikely", ["Page signals point to other regions."], ["Do you also have California consumers?"]);
  } else {
    set("cppa", "unknown", ["No clear US or data-collection signals."], ["Do you have California consumers?"]);
  }

  // ---- FTC click-to-cancel / ROSCA ----
  if (p.subscription.found) {
    set("ftc", "may", p.subscription.why.map((w) => "Subscription signal: " + w),
      ["Do you bill US consumers? State auto-renewal laws may also apply.", "Check your cancellation flow: this extension doesn't test it yet."]);
  } else {
    set("ftc", "unlikely", ["No subscription signals found on this page."], ["Do you sell subscriptions elsewhere on the site?"]);
  }

  // ---- India DPDP ----
  if (IN.has && p.data.collects) {
    set("dpdp", "likely", [...IN.why.map((w) => "India: " + w), "Collects personal data: " + p.data.why.join(", ")],
      ["Core duties start 13 May 2027 (per law-firm summaries). Confirm in the gazette.", "This extension doesn't test consent wording yet."]);
  } else if (!p.data.collects) {
    set("dpdp", "unlikely", ["No personal-data collection found on this page (forms, accounts, cookie banner)."], ["Do other pages collect data?"]);
  } else if (!anyRegion) {
    set("dpdp", "may", ["Collects personal data: " + p.data.why.join(", "), "No region signals."], ["Do you process data of people in India?"]);
  } else {
    set("dpdp", "unlikely", ["Page signals point to other regions."], ["Do you also process data of people in India?"]);
  }

  // ---- WCAG 3.0 ----
  set("wcag3", "info", ["A future standard; nothing to comply with yet."], []);

  // ---- What does THIS PAGE show against each rule? ----
  const related = (id) =>
    checks.filter((c) => {
      const m = CHECK_REFS[c.id];
      if (!m) return false;
      if (A11Y_REGS.includes(id)) return m.a11yRegs && !m.advisory;
      return (m.regs || []).includes(id);
    });
  for (const id of Object.keys(out)) {
    const rel = related(id);
    const failed = rel.filter((c) => c.status === "fail");
    out[id].page = { total: rel.length, failed: failed.map((c) => c.title), passed: rel.length - failed.length };
  }

  return out;
}

// Human-readable summary of the page profile (shown at the top of the report).
function describeProfile(p) {
  const lines = [];
  if (!p) return lines;
  if (p.gov && p.gov.is) lines.push("Government site");
  if (p.ecommerce.level === "likely") lines.push("Online shop");
  else if (p.ecommerce.level === "possible") lines.push("Possibly an online shop");
  if (p.subscription.found) lines.push("Subscriptions");
  if (p.platform.found) lines.push("Platform / user content");
  if (p.data.collects) lines.push("Collects personal data");
  const regs = [...new Set(p.regions.map((r) => r.region))];
  if (regs.length) lines.push("Region signals: " + regs.join(", "));
  if (p.pageKindWhy) lines.push("This page: " + p.pageKindWhy);
  return lines;
}
