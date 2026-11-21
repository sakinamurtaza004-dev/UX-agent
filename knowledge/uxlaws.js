// UX LAWS SCORECARD ENGINE
//
// Turns raw page measurements (from content/scanner.js -> result.ux) into a
// verdict per UX law/heuristic: followed | partly | not | na | unmeasured.
//
// IMPORTANT HONESTY NOTES
//  * UX laws are psychology principles, not legal rules and not exact formulas.
//    Every verdict here is a PROXY: a measurable stand-in for the idea.
//  * The thresholds (e.g. "7 menu links", "24px") are OUR rules of thumb, and
//    each entry says so. They are not part of the laws themselves.
//  * Some laws can't be judged from code at all (they need eyes). Those are
//    listed as "needs human/AI review" instead of pretending.
//
// Depends on globals from references.js: LAWS.

const VERDICT_LABEL = {
  followed: "Followed",
  partly: "Partly followed",
  not: "Not followed",
  na: "Not enough to judge",
  unmeasured: "Needs human / AI review",
};
const VERDICT_ORDER = ["not", "partly", "followed", "na", "unmeasured"];

function assessUxLaws(ux, profile, checks) {
  const out = [];
  const rank = { not: 0, partly: 1, followed: 2 };
  const worst = (...vs) => vs.filter(Boolean).sort((a, b) => rank[a] - rank[b])[0];
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const prof = profile || { ecommerce: { level: "none" }, subscription: {}, data: {}, gov: {} };

  const add = (id, verdict, evidence, how, fix, extra) => {
    const law = LAWS[id];
    out.push(Object.assign({ id, name: law.name, kind: law.kind, summary: law.summary, url: law.url, caveat: law.caveat || "", verdict, evidence, how, fix: fix || "" }, extra));
  };

  if (!ux) return out;

  // ---- Hick's Law: how many choices? ----
  {
    const nav = ux.navItems === null ? null : ux.navItems <= 7 ? "followed" : ux.navItems <= 10 ? "partly" : "not";
    const act = ux.aboveFoldChoices <= 25 ? "followed" : ux.aboveFoldChoices <= 50 ? "partly" : "not";
    const ev = [];
    ev.push(ux.navItems === null ? "No main navigation found." : `Main navigation has ${ux.navItems} links.`);
    ev.push(`${ux.aboveFoldChoices} links and buttons are visible on the first screen.`);
    add("hick", worst(nav, act), ev,
      "Counts links in the main nav (7 or fewer is good, 8-10 partly, over 10 not) and links/buttons on the first screen (25 or fewer good, 26-50 partly, over 50 not). These cut-offs are our rules of thumb, not part of the law. Laws of UX warns against treating 7 as a hard limit.",
      "Group or trim navigation, make one primary action obvious, and hide secondary options behind menus or progressive steps.");
  }

  // ---- Fitts's Law: target size ----
  if (ux.targetsTotal < 3) {
    add("fitts", "na", ["Fewer than 3 clickable targets found."], "Measures the size of buttons, form fields and block links.", "");
  } else {
    const p24 = pct(ux.targets24, ux.targetsTotal), p44 = pct(ux.targets44, ux.targetsTotal);
    const ev = [`${ux.targets24} of ${ux.targetsTotal} clickable targets are at least 24px in their smaller side (${p24}%); ${p44}% reach 44px.`];
    if (ux.filledCount) ev.push(`The largest highlighted button is ${ux.largestFilledPx}px on its smaller side.`);
    add("fitts", p24 >= 95 ? "followed" : p24 >= 80 ? "partly" : "not", ev,
      "Share of buttons, fields and block links at least 24px (95%+ followed, 80-94% partly, below 80% not). 24px is the WCAG 2.2 minimum; 44px is the comfortable touch size. Inline text links are excluded. Cut-offs for the verdict are our rule of thumb.",
      "Make small controls bigger or space them out, and make the main action large and close to where the user's attention already is.");
  }

  // ---- Jakob's Law: familiar conventions ----
  {
    const items = [
      ["Home/logo link at the top left", ux.logoTopLeft],
      ["Navigation near the top", ux.navNearTop],
      ["Footer with 3+ links", ux.footerLinks >= 3],
    ];
    if (ux.totalLinks > 30 || prof.ecommerce.level === "likely") items.push(["Search box", ux.searchPresent]);
    if (prof.ecommerce.level === "likely") items.push(["Cart at the top right", ux.cartTopRight]);
    if (ux.totalLinks < 5) {
      add("jakob", "na", ["Very few links, so there is little navigation to compare with other sites."], "Checks for common layout conventions.", "");
    } else {
      const ok = items.filter((i) => i[1]).map((i) => i[0]);
      const missing = items.filter((i) => !i[1]).map((i) => i[0]);
      const ratio = ok.length / items.length;
      add("jakob", ratio >= 0.8 ? "followed" : ratio >= 0.5 ? "partly" : "not",
        [`Present: ${ok.join(", ") || "none"}.`, missing.length ? `Not found: ${missing.join(", ")}.` : "All checked conventions found."],
        "Looks for conventions most sites share (logo top-left linking home, nav at the top, a footer with links, search on big sites, cart top-right on shops). 80%+ followed, 50-79% partly. Conventions vary by site type, so an unusual layout can be deliberate.",
        "Use familiar positions for logo, navigation, search and cart unless you have a strong reason, and test any unusual pattern with real users.");
    }
  }

  // ---- Miller's Law / chunking: walls of text ----
  if (ux.totalWords < 100) {
    add("miller", "na", ["Less than 100 words on the page."], "Looks at paragraph length and how often headings break up the text.", "");
  } else {
    const wph = ux.headingCount ? Math.round(ux.totalWords / ux.headingCount) : ux.totalWords;
    const bad = ux.longParagraphs >= 3 || wph > 500;
    const good = ux.longParagraphs === 0 && wph <= 300;
    add("miller", good ? "followed" : bad ? "not" : "partly",
      [`${ux.longParagraphs} of ${ux.paragraphs} text blocks are over 120 words (longest: ${ux.longestParagraph} words).`, `About ${wph} words per heading (${ux.headingCount} heading${ux.headingCount === 1 ? "" : "s"}, ${ux.totalWords} words).`],
      "Counts text blocks over 120 words and words per heading. Followed: no long blocks and 300 or fewer words per heading. Not followed: 3+ long blocks or over 500 words per heading. These numbers are our rules of thumb.",
      "Break long text into short paragraphs, lists and sections with descriptive headings.");
  }

  // ---- Doherty Threshold: speed ----
  if (ux.loadMs === null) {
    add("doherty", "na", ["The page hadn't finished loading when scanned."], "Uses the browser's page-load timings.", "", { partial: true });
  } else {
    const slowLoad = ux.loadMs > 3000, slowPaint = ux.fcpMs !== null && ux.fcpMs > 1800;
    const ev = [`Page finished loading at ${(ux.loadMs / 1000).toFixed(1)}s.`];
    if (ux.fcpMs !== null) ev.push(`First content appeared at ${(ux.fcpMs / 1000).toFixed(1)}s.`);
    add("doherty", slowLoad ? "not" : slowPaint ? "partly" : "followed", ev,
      "Partial measurement. The law is about the system responding to actions within about 400ms, which one scan can't test. We use page-load time as a stand-in: over 3s not followed, first content later than 1.8s partly. Both limits are our rules of thumb, measured on your connection on this one visit.",
      "Compress images, defer non-critical scripts, cache, and show progress for anything slower than a moment.",
      { partial: true });
  }

  // ---- Von Restorff: does the main action stand out? ----
  if (ux.aboveFoldChoices < 2) {
    add("vonrestorff", "na", ["Too few actions on the first screen."], "Looks for solid-coloured buttons on the first screen.", "");
  } else {
    const n = ux.filledCount;
    add("vonrestorff", n >= 1 && n <= 3 ? "followed" : n >= 7 ? "not" : "partly",
      [n === 0 ? "No solid-coloured button found on the first screen, so no action is visually emphasised." : `${n} solid-coloured button${n === 1 ? "" : "s"} on the first screen.`],
      "Counts solid-filled buttons on the first screen: 1-3 followed, 0 or 4-6 partly, 7+ not (when everything is highlighted, nothing stands out). Colour is only one way to emphasise something, so outline or text-only designs can score 'partly' unfairly.",
      "Give the single most important action a distinct style and keep the rest quieter.");
  }

  // ---- Similarity: do links look like links? ----
  if (ux.inlineLinks < 3) {
    add("similarity", "na", ["Fewer than 3 links inside paragraphs."], "Checks whether links inside text look different from the text around them.", "");
  } else {
    const p = pct(ux.distinctLinks, ux.inlineLinks);
    add("similarity", p >= 90 ? "followed" : p >= 60 ? "partly" : "not",
      [`${ux.distinctLinks} of ${ux.inlineLinks} links inside paragraphs are underlined, bolder or a different colour from the text (${p}%).`],
      "Share of in-text links that differ from surrounding text by underline, weight or colour (90%+ followed, 60-89% partly). Cut-offs are our rule of thumb.",
      "Underline links or make them clearly different from body text, and keep that treatment consistent.");
  }

  // ---- Nielsen: consistency and standards ----
  {
    const n = ux.fontFamilies.length;
    if (!n) add("nn4", "na", ["No text found."], "Counts the main typefaces used.", "");
    else add("nn4", n <= 3 ? "followed" : n === 4 ? "partly" : "not",
      [`${n} typeface${n === 1 ? "" : "s"} in use: ${ux.fontFamilies.slice(0, 5).join(", ")}.`],
      "Counts distinct typefaces (first font in each stack, icon fonts ignored): 3 or fewer followed, 4 partly, 5+ not. This covers one narrow slice of consistency, and the limit is our rule of thumb.",
      "Stick to one or two typefaces and a consistent set of sizes and styles.");
  }

  // ---- Nielsen: recognition rather than recall (via form labels) ----
  {
    const labelCheck = checks.find((c) => c.id === "form-labels");
    if (!ux.formFields || !labelCheck) add("nn6", "na", ["No form fields on this page."], "Uses the 'form fields have labels' check.", "");
    else add("nn6", labelCheck.status === "pass" ? "followed" : "not",
      [labelCheck.status === "pass" ? `All ${ux.formFields} form fields have a label.` : `${labelCheck.count} of ${ux.formFields} form fields have no proper label, so people must remember what they are for.`],
      "Reuses the 'Form fields have labels' check (placeholder-only fields count as unlabelled).",
      "Give each field a visible label that stays on screen while typing.");
  }

  // ---- Nielsen: help and documentation ----
  {
    const needsHelp = prof.ecommerce.level !== "none" || prof.subscription.found || prof.data.collects || (prof.gov && prof.gov.is);
    if (ux.helpLinks > 0) add("nn10", "followed", [`${ux.helpLinks} help/support/contact link${ux.helpLinks === 1 ? "" : "s"} found.`], "Looks for visible links mentioning help, support, FAQ or contact.", "");
    else if (needsHelp) add("nn10", "not", ["No help, support, FAQ or contact link found on a site that sells, collects data or serves the public."], "Looks for visible links mentioning help, support, FAQ or contact.", "Add a clearly visible Help/Contact link in the header or footer.");
    else add("nn10", "na", ["No help link found, but this looks like a simple content page."], "Looks for visible links mentioning help, support, FAQ or contact.", "");
  }

  // ---- Laws that can't be judged from code ----
  const unmeasured = {
    proximity: "Whether related things are placed close together is a visual judgment that needs a human or AI looking at the rendered page.",
    commonregion: "Whether groups are clearly bounded needs visual judgment (a screenshot review).",
    aesthetic: "Visual appeal is subjective and can't be measured from code.",
    cognitive: "Overall mental effort depends on the content, the task and the design together. It needs human testing or AI review.",
    serial: "Whether the most important items sit first and last depends on what counts as important, which needs human or AI review.",
    tesler: "Whether complexity is absorbed by the system or pushed onto the user depends on the task, which needs human or AI review.",
  };
  Object.entries(unmeasured).forEach(([id, why]) =>
    add(id, "unmeasured", [why], "Not measured automatically. Planned for the AI review step (screenshot + page text).", ""));

  return out.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
}
