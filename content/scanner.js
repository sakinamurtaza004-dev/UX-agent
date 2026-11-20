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
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
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
      return r.top >= 0 && r.top < vh && ctaWords.test(textOf(el) || el.value || el.getAttribute("aria-label") || "");
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
    summary: {
      passed: checks.filter((c) => c.status === "pass").length,
      failed: checks.filter((c) => c.status === "fail").length,
      total: checks.length,
    },
    checks,
  };
})();
