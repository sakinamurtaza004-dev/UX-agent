// CONTENT SCRIPT: runs INSIDE the web page being audited.
//
// It reads the page's DOM ("seating chart"), runs a set of rule-based UX checks,
// and returns a structured report to the popup.
//
// Every check produces:
//   id, category, title, severity (high|medium|low), status (pass|fail),
//   count, examples[], why (plain-language reason), fix (what to do), ref (standard label)
//
// NOTE: The "ref" field is only a short label for now (e.g. "WCAG 1.4.3").
// Step 3 will attach full UX laws, regulations and cited sources.
(() => {
  const MAX_EXAMPLES = 5;
  const checks = [];

  // ---------- helpers ----------
  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  // A link counts as "inside a sentence" (exempt from the minimum target size)
  // only if it is inline AND the text around it is a real sentence, not a row of links.
  const inSentence = (a) => {
    if (getComputedStyle(a).display !== "inline" || !a.parentElement) return false;
    const around = [...a.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(" ");
    return (around.trim().match(/\S+/g) || []).length >= 6;
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 &&
      s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"
    );
  };

  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (typeof el.className === "string" && el.className.trim()) {
      s += "." + el.className.trim().split(/\s+/)[0];
    }
    const t = textOf(el).slice(0, 40);
    return t ? `${s} "${t}"` : s;
  };

  // offenders: array of DOM elements or plain strings. Empty array = pass.
  const addCheck = ({ id, category, title, severity, offenders, why, fix, ref }) => {
    checks.push({
      id, category, title, severity,
      status: offenders.length ? "fail" : "pass",
      count: offenders.length,
      examples: offenders.slice(0, MAX_EXAMPLES).map((o) => (typeof o === "string" ? o : describe(o))),
      why, fix, ref,
    });
  };

  // ---------- colour maths (for contrast) ----------
  const parseColor = (str) => {
    const m = /rgba?\(([^)]+)\)/.exec(str || "");
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  // Walk up the tree to find what colour actually sits behind the text.
  // Returns null if a gradient/image is behind it (we can't measure that reliably).
  const effectiveBackground = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const luminance = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrastRatio = (a, b) => {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  // ---------- gather text elements once (used by contrast + font-size checks) ----------
  const textElements = [];
  {
    const seen = new Set();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && textElements.length < 1500) {
      if (!node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      seen.add(el);
      if (isVisible(el)) textElements.push(el);
    }
  }

  // =====================================================================
  // CATEGORY: Accessibility
  // =====================================================================

  // Images without alt text
  addCheck({
    id: "img-alt",
    category: "Accessibility",
    title: "Images have alt text",
    severity: "high",
    // Not filtered by size: an image that failed to load has zero size but still needs alt text.
    offenders: [...document.images].filter((i) => !i.hasAttribute("alt") && getComputedStyle(i).display !== "none"),
    why: "Screen-reader users hear nothing (or a file name) for these images, and the images can't be understood if they fail to load.",
    fix: 'Add a short, meaningful alt="..." to each image. Use alt="" for purely decorative ones.',
    ref: "WCAG 1.1.1",
  });

  // Text contrast
  {
    const offenders = [];
    let measured = 0;
    for (const el of textElements) {
      if (el.matches(":disabled")) continue;
      const s = getComputedStyle(el);
      const fg = parseColor(s.color);
      const bg = effectiveBackground(el);
      if (!fg || !bg) continue;
      measured++;
      const fgOpaque = fg.a < 1 ? blend(fg, bg) : fg;
      const ratio = contrastRatio(fgOpaque, bg);
      const size = parseFloat(s.fontSize);
      const bold = parseInt(s.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const needed = large ? 3 : 4.5;
      if (ratio < needed) {
        offenders.push(`${describe(el)} (contrast ${ratio.toFixed(1)}:1, needs ${needed}:1)`);
      }
    }
    addCheck({
      id: "contrast",
      category: "Accessibility",
      title: "Text has enough colour contrast",
      severity: "high",
      offenders,
      why: `Low-contrast text is hard to read for many people, especially in sunlight or with low vision. (${measured} text elements measured; text over images/gradients is skipped.)`,
      fix: "Darken the text or lighten the background until contrast is at least 4.5:1 (3:1 for large text).",
      ref: "WCAG 1.4.3",
    });
  }

  // Form fields without labels
  addCheck({
    id: "form-labels",
    category: "Accessibility",
    title: "Form fields have labels",
    severity: "high",
    offenders: [...document.querySelectorAll("input, select, textarea")].filter((el) => {
      if (el.matches('input[type="hidden"],input[type="submit"],input[type="button"],input[type="reset"],input[type="image"]')) return false;
      if (!isVisible(el)) return false;
      const hasLabel =
        el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
      return !hasLabel;
    }),
    why: "Without a real label, users of assistive tech don't know what to type. Placeholder text alone disappears as soon as you type.",
    fix: "Connect every field to a visible <label for=...> (or add aria-label when no visible label fits).",
    ref: "WCAG 3.3.2 / 4.1.2",
  });

  // Buttons / links with no accessible name
  addCheck({
    id: "control-names",
    category: "Accessibility",
    title: "Buttons and links have readable names",
    severity: "high",
    offenders: [...document.querySelectorAll("a[href], button, [role='button']")].filter((el) => {
      if (!isVisible(el)) return false;
      const hasName =
        textOf(el) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") ||
        el.querySelector("img[alt]:not([alt=''])") || el.querySelector("svg title") || el.value;
      return !hasName;
    }),
    why: "Icon-only buttons with no name are announced as just 'button' or 'link', so screen-reader users can't tell what they do.",
    fix: 'Add visible text, or an aria-label such as aria-label="Open menu".',
    ref: "WCAG 4.1.2 / 2.4.4",
  });

  // Page language
  addCheck({
    id: "lang",
    category: "Accessibility",
    title: "Page language is declared",
    severity: "medium",
    offenders: document.documentElement.getAttribute("lang") ? [] : ["<html> has no lang attribute"],
    why: "Screen readers use the language to choose the right pronunciation. Without it, text can sound garbled.",
    fix: 'Add lang="en" (or the right language code) to the <html> tag.',
    ref: "WCAG 3.1.1",
  });

  // Zoom disabled
  {
    const vp = document.querySelector('meta[name="viewport"]');
    const content = (vp && vp.getAttribute("content")) || "";
    const blocked = /user-scalable\s*=\s*(no|0)/i.test(content) || /maximum-scale\s*=\s*1(\.0)?\s*(,|$)/i.test(content);
    addCheck({
      id: "zoom",
      category: "Accessibility",
      title: "Pinch-zoom is allowed",
      severity: "medium",
      offenders: blocked ? [`viewport: "${content}"`] : [],
      why: "Blocking zoom stops people with low vision from enlarging the page.",
      fix: "Remove user-scalable=no and maximum-scale=1 from the viewport meta tag.",
      ref: "WCAG 1.4.4",
    });
  }

  // =====================================================================
  // CATEGORY: Readability & Structure
  // =====================================================================

  // Heading structure
  {
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(isVisible);
    const h1s = headings.filter((h) => h.tagName === "H1");
    addCheck({
      id: "h1",
      category: "Structure",
      title: "Page has exactly one main heading (H1)",
      severity: "medium",
      offenders: h1s.length === 1 ? [] : [h1s.length === 0 ? "No H1 found" : `${h1s.length} H1 headings found`],
      why: "The H1 tells users (and search engines) what the page is about. None, or many competing ones, blurs the message.",
      fix: "Use one H1 that states the page's main purpose; use H2-H6 for sub-sections.",
      ref: "WCAG 1.3.1 / 2.4.6",
    });

    const skips = [];
    let prev = 0;
    for (const h of headings) {
      const level = Number(h.tagName[1]);
      if (prev && level > prev + 1) skips.push(`${describe(h)} jumps from H${prev} to H${level}`);
      prev = level;
    }
    addCheck({
      id: "heading-order",
      category: "Structure",
      title: "Headings follow a logical order",
      severity: "low",
      offenders: skips,
      why: "Skipping levels (H2 straight to H4) breaks the outline that screen-reader users navigate by.",
      fix: "Step down one level at a time; style size with CSS, not by choosing the wrong heading level.",
      ref: "WCAG 1.3.1",
    });
  }

  // Small text
  addCheck({
    id: "font-size",
    category: "Readability",
    title: "Text is a comfortable size (12px or larger)",
    severity: "medium",
    offenders: textElements.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12),
    why: "Tiny text is tiring to read, particularly on phones.",
    fix: "Use at least 14-16px for body text and avoid anything below 12px.",
    ref: "Readability best practice",
  });

  // Vague link text
  addCheck({
    id: "link-text",
    category: "Readability",
    title: "Link text describes where it goes",
    severity: "low",
    offenders: [...document.querySelectorAll("a[href]")].filter(
      (a) => isVisible(a) && /^(click here|here|read more|more|learn more|link|this)$/i.test(textOf(a))
    ),
    why: "Links like 'click here' mean nothing out of context, and screen-reader users often browse a list of links only.",
    fix: "Make the link say the destination or action, e.g. 'Download the pricing guide'.",
    ref: "WCAG 2.4.4",
  });

  // =====================================================================
  // CATEGORY: Mobile & Touch
  // =====================================================================

  addCheck({
    id: "viewport",
    category: "Mobile",
    title: "Page is set up for mobile screens",
    severity: "high",
    offenders: document.querySelector('meta[name="viewport"]') ? [] : ["No viewport meta tag"],
    why: "Without it, phones show a tiny zoomed-out desktop layout.",
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    ref: "Responsive design",
  });

  addCheck({
    id: "tap-targets",
    category: "Mobile",
    title: "Tap targets are large enough (24px minimum)",
    severity: "medium",
    offenders: [...document.querySelectorAll("button, [role='button'], input:not([type='hidden']), select, a[href]")].filter((el) => {
      if (!isVisible(el) || el.matches(":disabled")) return false;
      // Links sitting inside a sentence are exempt from the size rule.
      if (el.tagName === "A" && inSentence(el)) return false;
      const r = el.getBoundingClientRect();
      return Math.min(r.width, r.height) < 24;
    }),
    why: "Small buttons are hard to hit with a thumb or for anyone with limited motor control; misses cause frustration and errors.",
    fix: "Make clickable items at least 24x24px (44x44px is the comfortable target) with spacing between them.",
    ref: "WCAG 2.5.8 / Fitts's Law",
  });

  // =====================================================================
  // CATEGORY: Conversion & Trust
  // =====================================================================

  {
    const ctaWords = /(get started|sign up|sign in|log in|buy|book|try|start|contact|download|subscribe|add to cart|shop|order|search|register|join|demo|pricing|learn more)/i;
    const vh = window.innerHeight;
    const aboveFold = [...document.querySelectorAll("a[href], button, [role='button'], input[type='submit']")].filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      // Use page position, not scroll position, so it doesn't matter where the user has scrolled.
      return r.top + window.scrollY < vh && r.bottom + window.scrollY > 0 && ctaWords.test(textOf(el) || el.value || el.getAttribute("aria-label") || "");
    });
    addCheck({
      id: "cta",
      category: "Conversion",
      title: "A clear call-to-action is visible without scrolling",
      severity: "medium",
      offenders: aboveFold.length ? [] : ["No action button/link found above the fold (heuristic check)"],
      why: "Visitors decide in seconds. If the next step isn't obvious immediately, many leave.",
      fix: "Put one primary action (e.g. 'Get started') above the fold with a verb-led label.",
      ref: "Hick's Law / conversion best practice",
    });
  }

  addCheck({
    id: "https",
    category: "Conversion",
    title: "Page is served securely (HTTPS)",
    severity: "high",
    offenders: location.protocol === "https:" || location.hostname === "localhost" ? [] : [`Protocol is ${location.protocol}`],
    why: "Browsers label HTTP pages 'Not secure', which destroys trust, especially on pages with forms or payments.",
    fix: "Install an SSL certificate and redirect all HTTP traffic to HTTPS.",
    ref: "Trust & security",
  });

  addCheck({
    id: "autoplay",
    category: "Conversion",
    title: "No sound plays automatically",
    severity: "medium",
    offenders: [...document.querySelectorAll("video[autoplay], audio[autoplay]")].filter((m) => !m.muted && !m.hasAttribute("muted")),
    why: "Unexpected audio startles users and is a top reason people leave a page.",
    fix: "Start media muted, or wait for the user to press play.",
    ref: "WCAG 1.4.2",
  });

  // =====================================================================
  // CATEGORY: Discoverability & Performance
  // =====================================================================

  addCheck({
    id: "title",
    category: "Discoverability",
    title: "Page has a descriptive title",
    severity: "medium",
    offenders: document.title && document.title.trim().length >= 10 ? [] : [`Title is "${document.title || ""}"`],
    why: "The title appears in browser tabs and search results; a missing or very short one says nothing about the page.",
    fix: "Write a unique 30-60 character title that says what the page offers.",
    ref: "WCAG 2.4.2",
  });

  {
    const md = document.querySelector('meta[name="description"]');
    addCheck({
      id: "meta-description",
      category: "Discoverability",
      title: "Page has a meta description",
      severity: "low",
      offenders: md && (md.getAttribute("content") || "").trim() ? [] : ["No meta description"],
      why: "It's the summary shown under your link in search results and shared links.",
      fix: "Add a 120-160 character summary that sells the page.",
      ref: "Search snippet best practice",
    });
  }

  {
    const total = document.querySelectorAll("*").length;
    addCheck({
      id: "dom-size",
      category: "Performance",
      title: "Page structure isn't excessively large",
      severity: "low",
      offenders: total > 3000 ? [`${total} elements on the page (over 3000)`] : [],
      why: "Very large pages use more memory and respond slower, especially on cheaper phones.",
      fix: "Trim hidden/duplicate markup, paginate or lazy-load long lists.",
      ref: "Performance best practice",
    });

    const nav = performance.getEntriesByType("navigation")[0];
    const loadMs = nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null;
    addCheck({
      id: "load-time",
      category: "Performance",
      title: "Page loads quickly (under 3 seconds)",
      severity: "medium",
      offenders: loadMs !== null && loadMs > 3000 ? [`Load finished at ${(loadMs / 1000).toFixed(1)}s`] : [],
      why: "Slow pages lose visitors; most people abandon after a few seconds. (Measured on your connection, on this visit only.)",
      fix: "Compress images, defer non-critical scripts, and use caching or a CDN.",
      ref: "Performance best practice",
    });
  }

  // =====================================================================
  // CATEGORY: Ethics & Trust (possible dark patterns)
  // These are HEURISTICS. They flag things worth a human look; they cannot
  // know intent (e.g. real stock levels are legitimate).
  // =====================================================================

  {
    const urgency = /\b(only \d+ (\w+ )?left|hurry|limited[- ]time|offer (ends|expires)|ends (in|soon|tonight|today)|last chance|selling (out )?fast|\d+ (people|others|persons) (are )?(viewing|looking|watching)|don'?t miss out)\b/i;
    const offenders = textElements.filter((el) => {
      const t = textOf(el);
      return t.length > 0 && t.length < 160 && urgency.test(t);
    });
    document.querySelectorAll('[class*="countdown" i], [id*="countdown" i]').forEach((el) => {
      if (isVisible(el) && !offenders.includes(el)) offenders.push(el);
    });
    addCheck({
      id: "pressure",
      category: "Ethics & Trust",
      title: "No pressure tactics found (possible false urgency)",
      severity: "medium",
      offenders,
      why: "Countdowns, 'only 2 left' and 'hurry' messages push people to decide fast. If the scarcity isn't real, regulators in several regions treat this as a dark pattern.",
      fix: "Only show urgency that is true and verifiable (real stock, real deadlines), and avoid fake timers.",
      ref: "Dark patterns",
    });
  }

  {
    const extras = /(newsletter|marketing|promo|offers|updates|partners|third[- ]part|insurance|protection|donat|extra|add[- ]?on|subscribe|share my)/i;
    const labelText = (el) => {
      const l = (el.labels && el.labels[0]) || el.closest("label");
      return (l ? textOf(l) : "") + " " + (el.getAttribute("aria-label") || "");
    };
    addCheck({
      id: "prechecked",
      category: "Ethics & Trust",
      title: "Optional extras and consents aren't pre-ticked",
      severity: "medium",
      offenders: [...document.querySelectorAll('input[type="checkbox"]:checked')].filter(
        (el) => isVisible(el) && extras.test(labelText(el))
      ).map((el) => `Pre-ticked: "${labelText(el).trim().slice(0, 60)}"`),
      why: "Boxes that are already ticked for marketing, insurance or donations rely on people not noticing. They can end up paying for or agreeing to things they never chose.",
      fix: "Leave optional extras and consents unticked so users opt in actively.",
      ref: "Dark patterns",
    });
  }

  {
    const shame = /\bno,? (thanks,? )?i (don'?t|do not|hate|prefer|would rather|like paying|already)|i (don'?t|do not) want (to )?(save|discount|deal|sale|offer|free|success|improve|grow|be healthy)/i;
    addCheck({
      id: "confirmshame",
      category: "Ethics & Trust",
      title: "Decline options use neutral wording (no confirm-shaming)",
      severity: "low",
      offenders: [...document.querySelectorAll("a, button, [role='button']")].filter(
        (el) => isVisible(el) && shame.test(textOf(el))
      ),
      why: "Wording like 'No thanks, I don't want to save money' guilt-trips people into saying yes.",
      fix: "Use plain, respectful wording for the decline option, such as 'No thanks'.",
      ref: "Dark patterns",
    });
  }

  // =====================================================================
  // SITE PROFILE (Step 3b)
  // Collects FACTS about the site (what it seems to be, where it seems to
  // operate, what data it collects). The popup's applicability engine turns
  // these into "does this law probably apply?" verdicts, with the evidence.
  // We record evidence strings so every verdict can be explained.
  // =====================================================================
  const profile = (() => {
    const host = location.hostname.toLowerCase();
    const path = location.pathname.toLowerCase();
    const text = ((document.body && document.body.innerText) || "").slice(0, 80000);
    const lower = text.toLowerCase();
    const count = (re) => (text.match(re) || []).length;

    // ---- region signals (where does this site seem to operate?) ----
    const regions = [];
    const addRegion = (region, strength, why) => {
      if (!regions.some((r) => r.region === region && r.why === why)) regions.push({ region, strength, why });
    };
    const EU = ["eu", "de", "fr", "it", "es", "nl", "be", "at", "pt", "ie", "se", "dk", "fi", "pl", "cz", "sk", "hu", "ro", "bg", "hr", "si", "ee", "lv", "lt", "lu", "mt", "cy", "gr"];
    const tld = host.split(".").pop();
    if (tld === "in") addRegion("IN", "strong", "Domain ends in .in");
    else if (EU.includes(tld)) addRegion("EU", "strong", `Domain ends in .${tld} (EU country)`);
    else if (tld === "us" || tld === "gov" || tld === "mil") addRegion("US", "strong", `Domain ends in .${tld}`);
    else if (tld === "uk") addRegion("UK", "strong", "Domain ends in .uk");

    const inr = count(/₹|\bINR\b|\bRs\.?\s?\d/g);
    const eur = count(/€|\bEUR\b/g);
    const gbp = count(/£|\bGBP\b/g);
    const usd = count(/\bUSD\b|US\$/g);
    const dollar = count(/\$\s?\d/g);
    if (inr >= 2) addRegion("IN", "strong", `Prices in Indian rupees (${inr} mentions)`);
    if (eur >= 2) addRegion("EU", "strong", `Prices in euros (${eur} mentions)`);
    if (gbp >= 2) addRegion("UK", "strong", `Prices in pounds (${gbp} mentions)`);
    if (usd >= 2) addRegion("US", "strong", `Prices in US dollars (${usd} mentions)`);
    else if (dollar >= 2) addRegion("US", "weak", `Prices in $ (${dollar} mentions; the $ sign is used in several countries)`);

    if (/\+91[\s-]?\d/.test(text)) addRegion("IN", "strong", "Phone number with +91 country code");
    if (/\+(49|33|39|34|31|32|43|351|353|46|45|358|48)[\s-]?\d/.test(text)) addRegion("EU", "strong", "Phone number with an EU country code");
    if (/\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}/.test(text)) addRegion("US", "weak", "Phone number with +1 (US/Canada)");

    const lang = (document.documentElement.getAttribute("lang") || "").toLowerCase();
    const sub = lang.split("-")[1];
    if (sub === "in") addRegion("IN", "strong", `Page language is ${lang}`);
    else if (sub === "us") addRegion("US", "weak", `Page language is ${lang}`);
    else if (sub === "gb") addRegion("UK", "weak", `Page language is ${lang}`);
    else if (sub && EU.includes(sub)) addRegion("EU", "strong", `Page language is ${lang}`);
    else if (!sub && ["de", "nl", "pl", "sv", "da", "fi", "cs", "el", "hu", "ro", "bg", "hr", "sk", "sl", "et", "lv", "lt"].includes(lang)) {
      addRegion("EU", "weak", `Page language is "${lang}", mostly used in the EU`);
    } else if (lang === "hi") addRegion("IN", "weak", 'Page language is "hi" (Hindi)');

    // ---- government? ----
    const isGov = /(^|\.)(gov|gouv|gob|govt)(\.[a-z]{2})?$/.test(host) || /\.nic\.in$/.test(host) || /(^|\.)europa\.eu$/.test(host);
    let govCountry = null;
    if (isGov) {
      if (/\.gov$/.test(host)) govCountry = "US";
      else if (/\.gov\.in$|\.nic\.in$/.test(host)) govCountry = "IN";
      else if (/europa\.eu$/.test(host)) govCountry = "EU";
      else govCountry = "other";
    }

    // ---- e-commerce? ----
    const clickables = [...document.querySelectorAll("a, button, [role='button'], input[type='submit']")].filter(isVisible).slice(0, 800);
    const labelOf = (el) => (textOf(el) || el.value || el.getAttribute("aria-label") || "").toLowerCase();
    const ecom = [];
    let ecomScore = 0;
    if (clickables.some((el) => /add to (cart|bag|basket|trolley)|buy now/.test(labelOf(el)))) { ecomScore += 2; ecom.push('"Add to cart" / "Buy now" button'); }
    if (clickables.some((el) => /^(cart|bag|basket|my cart|view cart|shopping cart)\b/.test(labelOf(el)) || /\/(cart|basket|bag)\b/.test(el.getAttribute("href") || ""))) { ecomScore += 1; ecom.push("Cart link"); }
    if ([...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => /"@type"\s*:\s*"(Product|Offer)"/.test(s.textContent))) { ecomScore += 1; ecom.push("Product data (schema.org) in the page"); }
    const priceCount = count(/(?:₹|€|£|\$|\brs\.?|\binr|\beur|\busd)\s?\d[\d,.]*/gi);
    if (priceCount >= 3) { ecomScore += 1; ecom.push(`${priceCount} prices shown`); }
    if (/(checkout|cart|basket|payment)/.test(path)) { ecomScore += 1; ecom.push("Cart/checkout address"); }
    const payFields = !!document.querySelector('input[autocomplete^="cc-"]');
    if (payFields) { ecomScore += 2; ecom.push("Card payment fields"); }
    const ecommerce = { level: ecomScore >= 3 ? "likely" : ecomScore === 2 ? "possible" : "none", why: ecom };

    // ---- subscriptions? ----
    const subPatterns = [
      [/\/\s?(month|mo|year|yr)\b|per (month|year)|a month|monthly|annual(ly)?/, "monthly/yearly pricing"],
      [/cancel any ?time/, '"cancel anytime"'],
      [/free trial|start (your )?(free )?trial/, "free trial"],
      [/subscribe|subscription/, '"subscribe"/"subscription"'],
    ];
    const subHits = subPatterns.filter(([re]) => re.test(lower)).map(([, name]) => name);
    const subscription = { found: subHits.length >= 2, why: subHits };

    // ---- online platform (marketplace / user content)? ----
    const platWhy = [];
    if (/(become a seller|sell on |seller central|marketplace|multiple vendors|our sellers)/.test(lower)) platWhy.push("Marketplace/seller wording");
    if (/(write a review|leave a comment|post a comment|add a comment)/.test(lower) ||
        [...document.querySelectorAll("textarea")].some((t) => isVisible(t) && /comment|review|post|reply/i.test(t.name + t.id + (t.placeholder || "")))) {
      platWhy.push("Users can post comments or reviews");
    }
    const platform = { found: platWhy.length > 0, why: platWhy };

    // ---- personal data? ----
    const inputs = [...document.querySelectorAll("input, textarea")].filter(isVisible);
    const emailN = inputs.filter((i) => i.type === "email" || /email/i.test(i.name + i.id + (i.autocomplete || ""))).length;
    const telN = inputs.filter((i) => i.type === "tel").length;
    const pwN = inputs.filter((i) => i.type === "password").length;
    const nameN = inputs.filter((i) => /^(name|given-name|family-name)$/.test(i.autocomplete || "")).length;
    const cookieBanner =
      [...document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i]')].some(isVisible) ||
      /we use cookies|this (web)?site uses cookies/.test(lower);
    const dataWhy = [];
    if (emailN) dataWhy.push("Email field");
    if (telN) dataWhy.push("Phone field");
    if (pwN) dataWhy.push("Account login/signup (password field)");
    if (nameN) dataWhy.push("Name field");
    if (cookieBanner) dataWhy.push("Cookie banner");
    const data = { collects: dataWhy.length > 0, why: dataWhy };

    // ---- what kind of page is this? ----
    let pageKind = "other", pageKindWhy = "";
    if (payFields || /(checkout|payment|billing)/.test(path)) { pageKind = "checkout"; pageKindWhy = "payment/checkout page"; }
    else if (/(cart|basket|bag)/.test(path)) { pageKind = "cart"; pageKindWhy = "cart page"; }
    else if (pwN) { pageKind = "login"; pageKindWhy = "login/signup page"; }
    else if (path === "/" || path === "") { pageKind = "home"; pageKindWhy = "home page"; }

    return { host, lang, gov: { is: isGov, country: govCountry }, regions, ecommerce, subscription, platform, data, pageKind, pageKindWhy };
  })();

  // =====================================================================
  // UX METRICS (feeds the UX laws scorecard)
  // Raw measurements only. knowledge/uxlaws.js decides what they mean.
  // "Above the fold" uses page position, so scrolling doesn't change it.
  // =====================================================================
  const ux = (() => {
    const vw = window.innerWidth, vh = window.innerHeight, sy = window.scrollY;
    const rect = (el) => el.getBoundingClientRect();
    const docTop = (el) => rect(el).top + sy;
    const words = (s) => (s.trim().match(/\S+/g) || []).length;
    const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(" ");
    const colorDiff = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    const dim = (el) => { const r = rect(el); return Math.min(r.width, r.height); };

    const clickSel = "a[href], button, [role='button'], input[type='submit'], input[type='button'], summary";
    const clickables = [...document.querySelectorAll(clickSel)].filter(isVisible).slice(0, 2000);
    const aboveFold = clickables.filter((el) => docTop(el) < vh && rect(el).bottom + sy > 0);

    // Hick's Law: how many choices?
    const nav = [...document.querySelectorAll("header nav, [role='banner'] nav, nav, [role='navigation']")].find(isVisible);
    const navItems = nav ? [...nav.querySelectorAll("a[href]")].filter(isVisible).length : null;

    // Fitts's Law: how big are the targets?
    const targets = [...document.querySelectorAll(clickSel + ", select, textarea, input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")]
      .filter((el) => isVisible(el) && !el.matches(":disabled") && !(el.tagName === "A" && inSentence(el)));

    // Von Restorff: which actions are visually emphasised (solid-filled buttons)?
    const filled = aboveFold.filter((el) => {
      if (el.tagName === "SUMMARY") return false;
      const label = textOf(el) || el.value || "";
      if (!label || label.length > 40) return false;
      const bg = parseColor(getComputedStyle(el).backgroundColor);
      if (!bg || bg.a < 0.9) return false;
      const r = rect(el);
      if (Math.min(r.width, r.height) < 24 || r.width < 48) return false;
      const behind = el.parentElement ? effectiveBackground(el.parentElement) : null;
      return !behind || colorDiff(bg, behind) > 90;
    });

    // Jakob's Law: familiar conventions
    const isHome = (a) => {
      try {
        const u = new URL(a.href, location.href);
        return u.origin === location.origin && /^\/(index|home)?(\.\w+)?\/?$/i.test(u.pathname);
      } catch (e) { return false; }
    };
    const footer = document.querySelector("footer, [role='contentinfo']");
    const cartRe = /\b(cart|bag|basket)\b/i;

    // Miller's Law / chunking: walls of text?
    const blocks = textElements.map((el) => words(own(el))).filter((n) => n >= 15);
    const headingCount = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(isVisible).length;
    const totalWords = words((document.body && document.body.innerText) || "");

    // Doherty: speed
    const nav0 = performance.getEntriesByType("navigation")[0];
    const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0];

    // Similarity: do inline links look different from the text around them?
    const inlineLinks = [...document.querySelectorAll("p a[href]")].filter(isVisible).filter((a) => words(own(a.closest("p"))) >= 6);
    const distinctLinks = inlineLinks.filter((a) => {
      const s = getComputedStyle(a), ps = getComputedStyle(a.parentElement);
      const c1 = parseColor(s.color), c2 = parseColor(ps.color);
      return s.textDecorationLine.includes("underline") ||
        (c1 && c2 && colorDiff(c1, c2) > 60) ||
        parseInt(s.fontWeight, 10) - parseInt(ps.fontWeight, 10) >= 200;
    }).length;

    // Nielsen consistency: how many typefaces?
    const fam = {};
    textElements.forEach((el) => {
      const f = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
      if (f && !/awesome|icon|material|glyph|symbol|emoji/.test(f)) fam[f] = (fam[f] || 0) + 1;
    });

    // Nielsen help: is help/contact easy to find?
    const helpRe = /\b(help|support|faq|contact|customer care|get in touch)\b/i;

    return {
      navItems,
      navLabels: nav ? [...nav.querySelectorAll("a[href]")].filter(isVisible).map((a) => textOf(a).slice(0, 60)).filter(Boolean).slice(0, 25) : [],
      ctaLabels: filled.map((el) => (textOf(el) || el.value || "").slice(0, 60)).slice(0, 10),
      aboveFoldChoices: aboveFold.length,
      targetsTotal: targets.length,
      targets24: targets.filter((el) => dim(el) >= 24).length,
      targets44: targets.filter((el) => dim(el) >= 44).length,
      filledCount: filled.length,
      largestFilledPx: Math.round(filled.reduce((m, el) => Math.max(m, dim(el)), 0)),
      logoTopLeft: clickables.some((a) => a.tagName === "A" && isHome(a) && docTop(a) < 200 && rect(a).left < vw * 0.35),
      navNearTop: !!nav && docTop(nav) < 250,
      footerLinks: footer ? [...footer.querySelectorAll("a[href]")].filter(isVisible).length : 0,
      searchPresent: [...document.querySelectorAll("input[type='search'], [role='search'], form[action*='search' i], input[name='q'], input[placeholder*='search' i], input[aria-label*='search' i]")].some(isVisible),
      cartTopRight: clickables.some((el) => cartRe.test(textOf(el) + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("href") || "")) && docTop(el) < 200 && rect(el).left > vw * 0.55),
      totalLinks: document.links.length,
      paragraphs: blocks.length,
      longParagraphs: blocks.filter((n) => n > 120).length,
      longestParagraph: blocks.reduce((m, n) => Math.max(m, n), 0),
      totalWords,
      headingCount,
      loadMs: nav0 && nav0.loadEventEnd > 0 ? Math.round(nav0.loadEventEnd) : null,
      fcpMs: fcpEntry ? Math.round(fcpEntry.startTime) : null,
      inlineLinks: inlineLinks.length,
      distinctLinks,
      fontFamilies: Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`),
      formFields: [...document.querySelectorAll("input, select, textarea")].filter((el) => isVisible(el) && !el.matches("input[type='hidden'],input[type='submit'],input[type='button'],input[type='reset'],input[type='image']")).length,
      helpLinks: clickables.filter((el) => el.tagName === "A" && helpRe.test((textOf(el) || el.getAttribute("aria-label") || "").slice(0, 60))).length,
    };
  })();

  // =====================================================================
  // PAGE CONTENT (only used if the user clicks "Run AI review")
  // Text the AI reads. Form values are never included (innerText excludes
  // what people typed into fields) and the text is capped.
  // =====================================================================
  const pageContent = (() => {
    const md = document.querySelector('meta[name="description"]');
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
    return {
      metaDescription: clean(md && md.getAttribute("content")).slice(0, 480),
      headings: [...document.querySelectorAll("h1,h2,h3")].filter(isVisible).map((h) => clean(h.textContent).slice(0, 160)).filter(Boolean).slice(0, 30),
      text: ((document.body && document.body.innerText) || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 9000),
    };
  })();

  // ---------- scoring ----------
  const WEIGHT = { high: 3, medium: 2, low: 1 };
  const score = (list) => {
    const total = list.reduce((n, c) => n + WEIGHT[c.severity], 0);
    const earned = list.filter((c) => c.status === "pass").reduce((n, c) => n + WEIGHT[c.severity], 0);
    return total ? Math.round((earned / total) * 100) : 100;
  };
  const categories = {};
  for (const c of checks) (categories[c.category] = categories[c.category] || []).push(c);
  const categoryScores = Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, score(v)]));

  return {
    url: location.href,
    title: document.title || "(no title)",
    scannedAt: new Date().toISOString(),
    score: score(checks),
    categoryScores,
    profile,
    ux,
    pageContent,
    summary: {
      passed: checks.filter((c) => c.status === "pass").length,
      failed: checks.filter((c) => c.status === "fail").length,
      total: checks.length,
    },
    checks,
  };
})();
