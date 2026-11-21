// KNOWLEDGE BASE: UX laws, standards and regulations, with sources.
//
// Everything here was researched via web search on VERIFIED_ON. Laws change,
// so each entry carries a status line, a caveat where sources disagreed or
// where we could not confirm something, and links to the sources used.
// Only URLs that appeared in search results are used.
//
// This is general information, NOT legal advice.

const VERIFIED_ON = "2026-11-21";

// ---------------------------------------------------------------------------
// UX laws & heuristics (design psychology, not legal requirements)
// ---------------------------------------------------------------------------
const LAWS = {
  hick: {
    name: "Hick's Law",
    kind: "UX law",
    summary: "The more options you show, the longer people take to decide. Fewer, clearer choices make decisions faster.",
    url: "https://lawsofux.com/hicks-law/",
    source: "Laws of UX",
  },
  fitts: {
    name: "Fitts's Law",
    kind: "UX law",
    summary: "The time to hit a target depends on how big and how close it is. Bigger, nearer buttons are easier to hit, especially on touch screens.",
    url: "https://lawsofux.com/",
    source: "Laws of UX",
  },
  doherty: {
    name: "Doherty Threshold",
    kind: "UX law",
    summary: "People stay productive when a system responds in under about 400 milliseconds. Slower than that, show progress.",
    caveat: "400 ms is a widely cited benchmark rather than a settled figure. Our page-load check uses a looser 3-second limit for whole pages.",
    url: "https://lawsofux.com/",
    source: "Laws of UX",
  },
  nn6: {
    name: "Nielsen heuristic: Recognition rather than recall",
    kind: "UX heuristic",
    summary: "Keep information visible instead of making people remember it. A placeholder that vanishes while typing forces users to remember what the field was for.",
    url: "https://www.nngroup.com/articles/ten-usability-heuristics/",
    source: "Nielsen Norman Group",
  },
};

// ---------------------------------------------------------------------------
// WCAG 2.2 success criteria (the technical accessibility standard)
// ---------------------------------------------------------------------------
const WCAG = {
  alt:      { name: "WCAG 1.1.1 Non-text Content (Level A)", summary: "Images and other non-text content need a text alternative so the information isn't lost.", url: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content" },
  contrast: { name: "WCAG 1.4.3 Contrast (Minimum) (Level AA)", summary: "Text needs a contrast ratio of at least 4.5:1 against its background (3:1 for large text: 18pt, or 14pt bold).", url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html" },
  labels:   { name: "WCAG 3.3.2 Labels or Instructions (Level A)", summary: "When content asks for input, labels or instructions must be provided.", url: "https://www.w3.org/TR/WCAG22/" },
  nrv:      { name: "WCAG 4.1.2 Name, Role, Value (Level A)", summary: "Every interface component needs a name and role that software (such as a screen reader) can determine.", url: "https://www.w3.org/TR/WCAG22/" },
  link:     { name: "WCAG 2.4.4 Link Purpose (In Context) (Level A)", summary: "A link's purpose should be clear from its text, or its text plus its surrounding context.", url: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html" },
  lang:     { name: "WCAG 3.1.1 Language of Page (Level A)", summary: "The page's main language must be identifiable by software so screen readers use the right pronunciation.", url: "https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html" },
  resize:   { name: "WCAG 1.4.4 Resize Text (Level AA)", summary: "Text must be resizable up to 200% without losing content or function.", url: "https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html" },
  info:     { name: "WCAG 1.3.1 Info and Relationships (Level A)", summary: "Structure shown visually (like headings and labels) must also be available to software.", url: "https://www.w3.org/WAI/WCAG22/quickref/" },
  headings: { name: "WCAG 2.4.6 Headings and Labels (Level AA)", summary: "If headings or labels exist they must be descriptive. (It doesn't force you to add them.)", url: "https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html" },
  title:    { name: "WCAG 2.4.2 Page Titled (Level A)", summary: "Pages need titles that describe their topic or purpose.", url: "https://www.w3.org/TR/WCAG22/" },
  audio:    { name: "WCAG 1.4.2 Audio Control (Level A)", summary: "If audio plays automatically for more than 3 seconds, users need a way to pause or stop it.", url: "https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html" },
  target:   { name: "WCAG 2.5.8 Target Size (Minimum) (Level AA)", summary: "Clickable targets should be at least 24x24 CSS pixels, or have enough spacing. Inline links in text are exempt.", url: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html" },
};

// ---------------------------------------------------------------------------
// Regulations & policy (changing quickly, so each one has a status + caveat)
// ---------------------------------------------------------------------------
const REGS = {
  wcag3: {
    name: "WCAG 3.0 (the future standard)",
    region: "Global (W3C)",
    status: "Working draft, not yet a standard",
    summary: "WCAG 2.2 is still the operative standard. W3C says WCAG 3 is not expected to be completed for a few more years, and it does not deprecate WCAG 2. AbilityNet's overview anticipates a Candidate Recommendation in Q4 2027, and a full Recommendation no earlier than 2028.",
    caveat: "Sources disagreed on the date of the latest draft (March vs September 2026). Check W3C directly.",
    sources: [
      { label: "W3C: WCAG 3 introduction", url: "https://www.w3.org/WAI/WCAG3" },
      { label: "W3C: WCAG 2.2", url: "https://www.w3.org/TR/WCAG22/" },
    ],
  },
  eaa: {
    name: "European Accessibility Act (EAA)",
    region: "EU",
    status: "Applies since 28 June 2025",
    summary: "Many consumer-facing digital services, including e-commerce, sold in the EU must be accessible. Conforming to the EN 301 549 standard gives a presumption of compliance; its current version incorporates WCAG 2.1 AA. One source notes non-EU businesses selling to EU customers can be in scope.",
    caveat: "Penalties and regulators differ by country. A figure of up to EUR 100,000 per infringement came from a vendor blog and is unverified. An update of EN 301 549 for WCAG 2.2 is pending and I could not confirm it. Check national law and whether any exemptions apply to you.",
    sources: [
      { label: "Ireland NDA: What is the EAA?", url: "https://nda.ie/accessibility/european-accessibility-act" },
      { label: "Taylor Wessing: The EAA takes shape (Mar 2026)", url: "https://www.taylorwessing.com/en/insights-and-events/insights/2026/03/the-eaa-takes-shape" },
    ],
  },
  ada2: {
    name: "US ADA Title II web rule",
    region: "USA (state & local government)",
    status: "Adopted Apr 2024; deadlines extended one year (20 Apr 2026)",
    summary: "State and local government web content and mobile apps must meet WCAG 2.1 AA. New dates: 26 April 2027 for entities with 50,000+ residents, and 26 April 2028 for smaller entities and special districts.",
    caveat: "This rule covers public bodies, not private businesses (private-sector web accessibility under the ADA is separate and wasn't researched here). Some pages still show the old dates. DOJ accepted comments until 22 June 2026; I didn't check later developments.",
    sources: [
      { label: "Federal Register, 20 Apr 2026 (extension)", url: "https://www.govinfo.gov/content/pkg/FR-2026-04-20/html/2026-07663.htm" },
      { label: "Federal Register, 24 Apr 2024 (original rule)", url: "https://www.federalregister.gov/documents/2024/04/24/2024-07758/nondiscrimination-on-the-basis-of-disability-accessibility-of-web-information-and-services-of-state" },
    ],
  },
  india_a11y: {
    name: "India: RPwD Act, GIGW 3.0 & IS 17802",
    region: "India",
    status: "Government sites: GIGW 3.0. Private-sector force: sources disagree",
    summary: "India's official GIGW 3.0 adopts its accessibility criteria from W3C WCAG (2.1), and government sites state they aim for WCAG 2.1 AA. Deque describes the RPwD Act as mandating digital accessibility across sectors.",
    caveat: "Several sources are vendor blogs that may overstate legal force. A claim that IS 17802 is now a legal requirement could not be verified. Check the Act, MeitY notifications and a lawyer.",
    sources: [
      { label: "GIGW 3.0: accessibility guidelines", url: "https://guidelines.india.gov.in/accessibility-guidelines-and-attributes/" },
      { label: "Deque: India's accessibility laws", url: "https://www.deque.com/apac-digital-accessibility-laws/india/" },
    ],
  },
  india_dark: {
    name: "India: Guidelines for Prevention and Regulation of Dark Patterns, 2023",
    region: "India",
    status: "Issued 30 Nov 2023; enforcement actions reported",
    summary: "The Central Consumer Protection Authority named 13 dark patterns: false urgency, basket sneaking, confirm shaming, forced action, subscription trap, interface interference, bait and switch, drip pricing, disguised advertisements, nagging, trick wording, SaaS billing and rogue malwares.",
    caveat: "Sources conflict on whether the guidelines are binding or voluntary. Reported penalties (PhysicsWallah INR 5 lakh, McAfee INR 1 lakh) were brought under the Consumer Protection Act, E-Commerce Rules and these guidelines together. A 2025 advisory asked platforms to self-audit.",
    sources: [
      { label: "PIB press release (Nov 2023)", url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=1983994&reg=48&lang=2" },
      { label: "CCPA: guidelines and advisories", url: "https://ccpa.doca.gov.in/guidelines.php" },
    ],
  },
  dsa25: {
    name: "EU Digital Services Act, Article 25",
    region: "EU",
    status: "In the DSA (OJ L 277, 27 Oct 2022)",
    summary: "Online platforms must not design or run their interfaces in ways that deceive or manipulate users or materially distort their free, informed choices. Recital 67 describes dark patterns this way.",
    caveat: "Applies to online platform providers only, and excludes practices already covered by the Unfair Commercial Practices Directive or GDPR. Academic commentators call it vague. I read summaries, not the Official Journal text.",
    sources: [{ label: "DSA Article 25 (springlex)", url: "https://www.springlex.eu/en/packages/dsa/dsa-regulation/article-25/" }],
  },
  dfa: {
    name: "EU Digital Fairness Act (proposal)",
    region: "EU",
    status: "PROPOSED, not law",
    summary: "Early commentary says the Commission proposed it on 11 November 2026. Draft Article 10 reportedly bans 10 specific dark-pattern design features, would let the Commission fine companies up to 6% of worldwide turnover, and would replace the 2005 Unfair Commercial Practices Directive.",
    caveat: "Based on early commentary only. Parliament and Council still have to negotiate, and the text may change. Verify against the official text.",
    sources: [{ label: "European Parliament legislative train: Digital Fairness Act", url: "https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act" }],
  },
  cppa: {
    name: "California: dark-pattern rules & CPPA advisory",
    region: "USA (California)",
    status: "Regulations in force; 2024 enforcement advisory",
    summary: "An interface is a dark pattern if it has the effect of substantially subverting or impairing user autonomy or choice, whatever the business intended. The CPPA's 2024 advisory stresses presenting privacy choices clearly and in a balanced way.",
    sources: [{ label: "CPPA enforcement advisory (Sept 2024)", url: "https://www.cppa.ca.gov/announcements/2024/20240904.html" }],
  },
  ftc: {
    name: "US FTC \"click-to-cancel\" & ROSCA",
    region: "USA",
    status: "Rule vacated Jul 2025; rulemaking restarted Mar 2026",
    summary: "The Eighth Circuit vacated the FTC's negative-option (click-to-cancel) rule on procedural grounds on 8 July 2025. The FTC asked for comment on updates on 11 March 2026 but is still enforcing the same subscription practices under ROSCA and Section 5. Many state auto-renewal laws still apply.",
    caveat: "I found no final replacement rule in sources up to May 2026, and did not check later. No subscription-cancellation check exists in this extension yet.",
    sources: [{ label: "Gibson Dunn: FTC restarts negative option rulemaking", url: "https://gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/" }],
  },
  dpdp: {
    name: "India: Digital Personal Data Protection Rules, 2025",
    region: "India",
    status: "Notified 17 Nov 2025; core duties phased in from 13 May 2027",
    summary: "Consent notices must be clear, accessible and kept separate from other information. People must be able to withdraw consent as easily as they gave it.",
    caveat: "Dates come from law-firm summaries. Confirm them in the official gazette notification. No consent-banner check exists in this extension yet.",
    sources: [{ label: "SCC Online: DPDP Rules 2025 key highlights", url: "https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/" }],
  },
};

// ---------------------------------------------------------------------------
// Which references explain each check.
//   laws: UX laws/heuristics   wcag: WCAG criteria   regs: regulations
//   a11yRegs: show the accessibility laws that point at WCAG
//   note: honest context (e.g. "best practice only")
// ---------------------------------------------------------------------------
const A11Y_REGS = ["eaa", "ada2", "india_a11y"];

const CHECK_REFS = {
  "img-alt":      { wcag: ["alt"], a11yRegs: true },
  "contrast":     { wcag: ["contrast"], a11yRegs: true },
  "form-labels":  { wcag: ["labels", "nrv"], laws: ["nn6"], a11yRegs: true },
  "control-names":{ wcag: ["nrv", "link"], a11yRegs: true },
  "lang":         { wcag: ["lang"], a11yRegs: true },
  "zoom":         { wcag: ["resize"], a11yRegs: true },
  "h1":           { wcag: ["info", "headings"], a11yRegs: true, advisory: true,
                    note: "WCAG does not require exactly one H1. That part is a structure and search best practice." },
  "heading-order":{ wcag: ["info"], a11yRegs: true, advisory: true,
                    note: "Skipped heading levels are generally treated as advisory rather than a hard WCAG failure." },
  "font-size":    { wcag: ["resize"],
                    note: "WCAG sets no minimum font size, only that text must be resizable. 12px is a best-practice threshold, not a legal one." },
  "link-text":    { wcag: ["link"], a11yRegs: true },
  "viewport":     { note: "Best practice for mobile usability, not a legal requirement." },
  "tap-targets":  { wcag: ["target"], laws: ["fitts"],
                    note: "WCAG 2.5.8 is NEW in WCAG 2.2. The laws above currently reference WCAG 2.1, which doesn't include it, so treat this as good practice for now rather than a legal requirement." },
  "cta":          { laws: ["hick"], note: "Heuristic check: it looks for action words above the fold and can be wrong." },
  "https":        { note: "Best practice for user trust and security, not tied to the laws above." },
  "autoplay":     { wcag: ["audio"], a11yRegs: true },
  "title":        { wcag: ["title"], a11yRegs: true },
  "meta-description": { note: "Search-snippet best practice, not a legal requirement." },
  "dom-size":     { note: "Performance best practice, not a legal requirement." },
  "load-time":    { laws: ["doherty"] },
  "pressure":     { regs: ["india_dark", "dsa25", "dfa", "cppa"],
                    note: "Possible 'false urgency' (named in India's list). This is a heuristic flag: genuine stock levels and real deadlines are fine, so review manually. It is not a legal finding." },
  "prechecked":   { regs: ["india_dark", "dsa25", "dfa", "cppa"],
                    note: "Pre-ticked extras or consents may relate to 'basket sneaking' or 'interface interference' in India's list. That is an interpretation, not a legal finding." },
  "confirmshame": { regs: ["india_dark", "dsa25", "dfa", "cppa"],
                    note: "Possible 'confirm shaming' (named in India's list): guilt-tripping wording on the decline option. Heuristic flag, review manually." },
};
