// PDF WRITER: builds a real, selectable-text PDF file entirely inside the extension.
// No library, no network, no print dialog: the report downloads directly.
//
// How it works, in plain terms:
//   1. The report is described as simple "blocks" (headings, paragraphs, cards...)
//      by lib/report-doc.js.
//   2. This file turns blocks into positioned drawing steps ("atoms"), wraps the
//      text using known character widths, and starts a new page when one is full.
//   3. It then writes the PDF file format by hand (pages, fonts, links, page numbers).
//
// Fonts: the PDF standard fonts Helvetica and Helvetica-Bold (built into every PDF reader,
// so nothing is embedded). They cover Latin text. Other scripts (for example Devanagari or
// emoji) can't be drawn and appear as "?"; the HTML download keeps every character.
//
// Depends on lib/pdf-fonts.js (PDF_WIDTHS).

const PdfWriter = (() => {
  const PW = 595.28, PH = 841.89;          // A4 in points
  const MX = 46, MT = 46, MB = 54;         // margins
  const CW = PW - 2 * MX;                  // content width
  const BOTTOM = PH - MB;

  // ---------------------------------------------------------------- text encoding
  // PDF's "WinAnsi" encoding = Latin-1 plus a few typographic characters.
  const WIN = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "‰": 0x89, "‹": 0x8b, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b };
  const TRANS = { "→": "->", "←": "<-", "↑": "^", "↓": "v", "≥": ">=", "≤": "<=", "≠": "!=", "✓": "OK", "✔": "OK", "✗": "x", "✕": "x", "₹": "INR ", "‑": "-", "−": "-", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "×": "×", "·": "·", "‣": "•", "◦": "•", "▪": "•", "★": "*", "☆": "*" };

  // Returns a "byte string" (every character code is 0-255) that the PDF can show.
  function toBytes(str) {
    let out = "";
    for (const ch of String(str == null ? "" : str).normalize("NFC")) {
      const c = ch.codePointAt(0);
      if (c === 0x0a || c === 0x0d || c === 0x09) { out += " "; continue; }
      if (c < 0x20 || (c >= 0x7f && c < 0xa0)) continue;
      if (c >= 0x300 && c <= 0x36f) continue;                                   // loose accents
      if ((c >= 0x200b && c <= 0x200f) || c === 0x2060 || c === 0xfeff || (c >= 0xfe00 && c <= 0xfe0f)) continue;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) { out += ch; continue; }
      if (WIN[ch] !== undefined) { out += String.fromCharCode(WIN[ch]); continue; }
      if (TRANS[ch] !== undefined) { out += TRANS[ch]; continue; }
      out += "?";
    }
    return out;
  }

  // ---------------------------------------------------------------- widths
  const SPECIAL = { 0x80: [556, 556], 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000], 0xa0: [278, 278], 0xa9: [737, 737], 0xae: [737, 737], 0xb0: [400, 400], 0xb7: [278, 278], 0xd7: [584, 584], 0xab: [556, 556], 0xbb: [556, 556], 0xbf: [611, 611], 0xa1: [333, 333], 0xdf: [611, 611], 0xc6: [1000, 1000], 0xe6: [889, 889], 0xd8: [778, 778], 0xf8: [611, 611] };
  function charW(code, bold) {
    if (code >= 32 && code <= 126) return PDF_WIDTHS[bold ? "bold" : "regular"][code - 32];
    if (SPECIAL[code]) return SPECIAL[code][bold ? 1 : 0];
    const base = String.fromCharCode(code).normalize("NFD")[0].charCodeAt(0);   // é -> e
    return base >= 32 && base <= 126 ? PDF_WIDTHS[bold ? "bold" : "regular"][base - 32] : 556;
  }
  function textW(bytes, bold, size) {
    let w = 0;
    for (let i = 0; i < bytes.length; i++) w += charW(bytes.charCodeAt(i), bold);
    return (w * size) / 1000;
  }

  // Wrap a byte string to a width. Long unbroken words (URLs) are split by character.
  function wrap(bytes, bold, size, maxW) {
    const lines = [];
    let line = "";
    const push = () => { lines.push(line); line = ""; };
    for (const word of String(bytes).split(" ").filter((w) => w.length)) {
      const attempt = line ? line + " " + word : word;
      if (textW(attempt, bold, size) <= maxW) { line = attempt; continue; }
      if (line) push();
      if (textW(word, bold, size) <= maxW) { line = word; continue; }
      let chunk = "";
      for (const ch of word) {
        if (textW(chunk + ch, bold, size) > maxW && chunk) { lines.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    if (line || !lines.length) push();
    return lines;
  }

  // ---------------------------------------------------------------- colours
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const rgb = (h) => hex(h).map((v) => v.toFixed(3)).join(" ");
  const C = { ink: "#101828", mute: "#475467", faint: "#667085", line: "#EAECF0", brand: "#4F46E5", track: "#F2F4F7", white: "#FFFFFF", bg: "#F8F8FB" };
  const TONES = {
    high: ["#FEE4E2", "#B42318"], medium: ["#FEF0C7", "#93370D"], low: ["#F2F4F7", "#344054"],
    followed: ["#DCFAE6", "#067647"], partly: ["#FEF0C7", "#93370D"], not: ["#FEE4E2", "#B42318"], na: ["#F2F4F7", "#475467"], unmeasured: ["#EEF0FF", "#3730A3"],
    likely: ["#FEF0C7", "#93370D"], may: ["#FEF0C7", "#93370D"], pending: ["#E0F2FE", "#026AA2"], unknown: ["#F2F4F7", "#475467"], unlikely: ["#F2F4F7", "#667085"], info: ["#F2F4F7", "#344054"],
    ai: ["#EEF0FF", "#3730A3"], brand: ["#EEF0FF", "#3730A3"],
  };
  const scoreFill = (v) => (v < 50 ? "#F04438" : v < 80 ? "#F79009" : "#17B26A");
  const scoreInk = (v) => (v < 50 ? "#B42318" : v < 80 ? "#B54708" : "#067647");

  // ---------------------------------------------------------------- one page
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  class Page {
    constructor() { this.ops = []; this.annots = []; }
    // y values are measured from the TOP of the page (PDF itself measures from the bottom)
    text(bytes, x, baseline, { bold = false, size = 9.5, color = C.ink } = {}) {
      if (!bytes) return;
      this.ops.push(`BT /${bold ? "F2" : "F1"} ${n2(size)} Tf ${rgb(color)} rg ${n2(x)} ${n2(PH - baseline)} Td (${esc(bytes)}) Tj ET`);
    }
    rect(x, y, w, h, { fill, stroke, lw = 0.75, r = 0 } = {}) {
      const yb = PH - y - h;
      const path = r > 0 ? roundRect(x, yb, w, h, r) : `${n2(x)} ${n2(yb)} ${n2(w)} ${n2(h)} re`;
      const ops = [];
      if (fill) ops.push(`${rgb(fill)} rg`);
      if (stroke) ops.push(`${rgb(stroke)} RG ${n2(lw)} w`);
      this.ops.push(`${ops.join(" ")} ${path} ${fill && stroke ? "B" : fill ? "f" : "S"}`);
    }
    line(x1, y1, x2, y2, { color = C.line, lw = 0.75 } = {}) {
      this.ops.push(`${rgb(color)} RG ${n2(lw)} w ${n2(x1)} ${n2(PH - y1)} m ${n2(x2)} ${n2(PH - y2)} l S`);
    }
    // Arc from angle a0 to a1 (radians, 0 = 3 o'clock, clockwise on screen), drawn with Bezier curves.
    arc(cx, cy, r, a0, a1, { color = C.ink, lw = 6, cap = 1 } = {}) {
      const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
      const step = (a1 - a0) / segs, k = (4 / 3) * Math.tan(step / 4);
      const P = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const [sx, sy] = P(a0);
      let d = `${n2(sx)} ${n2(PH - sy)} m`;
      for (let i = 0; i < segs; i++) {
        const s = a0 + i * step, e = s + step;
        const [x1, y1] = P(s), [x2, y2] = P(e);
        const c1 = [x1 - k * r * Math.sin(s), y1 + k * r * Math.cos(s)], c2 = [x2 + k * r * Math.sin(e), y2 - k * r * Math.cos(e)];
        d += ` ${n2(c1[0])} ${n2(PH - c1[1])} ${n2(c2[0])} ${n2(PH - c2[1])} ${n2(x2)} ${n2(PH - y2)} c`;
      }
      this.ops.push(`${rgb(color)} RG ${n2(lw)} w ${cap} J ${d} S 0 J`);
    }
    link(x, y, w, h, url) { this.annots.push({ rect: [x, PH - y - h, x + w, PH - y], url }); }
  }
  function roundRect(x, yb, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    const k = 0.5523 * r;
    return `${n2(x + r)} ${n2(yb)} m ${n2(x + w - r)} ${n2(yb)} l ${n2(x + w - r + k)} ${n2(yb)} ${n2(x + w)} ${n2(yb + r - k)} ${n2(x + w)} ${n2(yb + r)} c ` +
      `${n2(x + w)} ${n2(yb + h - r)} l ${n2(x + w)} ${n2(yb + h - r + k)} ${n2(x + w - r + k)} ${n2(yb + h)} ${n2(x + w - r)} ${n2(yb + h)} c ` +
      `${n2(x + r)} ${n2(yb + h)} l ${n2(x + r - k)} ${n2(yb + h)} ${n2(x)} ${n2(yb + h - r + k)} ${n2(x)} ${n2(yb + h - r)} c ` +
      `${n2(x)} ${n2(yb + r)} l ${n2(x)} ${n2(yb + r - k)} ${n2(x + r - k)} ${n2(yb)} ${n2(x + r)} ${n2(yb)} c h`;
  }

  // ---------------------------------------------------------------- atoms (things with a height that know how to draw themselves)
  const spacer = (h) => ({ h, draw() {} });
  const lineAtom = (bytes, { bold = false, size = 9.5, color = C.ink, lead, indent = 0 } = {}) => ({
    h: lead || size * 1.42,
    draw(p, x, y) { p.text(bytes, x + indent, y + (lead || size * 1.42) * 0.76, { bold, size, color }); },
  });
  function para(str, w, opts = {}) {
    const { bold = false, size = 9.5, color = C.ink, indent = 0, lead = size * 1.42, gap = 0 } = opts;
    const atoms = wrap(toBytes(str), bold, size, w - indent).map((l) => lineAtom(l, { bold, size, color, lead, indent }));
    if (gap) atoms.push(spacer(gap));
    return atoms;
  }
  const pillW = (bytes, size = 7) => textW(bytes, true, size) + 10;
  function drawPill(p, x, y, bytes, tone, size = 7) {
    const [bg, fg] = TONES[tone] || TONES.info;
    const w = pillW(bytes, size);
    p.rect(x, y, w, size + 6, { fill: bg, r: 3 });
    p.text(bytes, x + 5, y + size + 1.5, { bold: true, size, color: fg });
    return w;
  }
  const upper = (s) => toBytes(s).toUpperCase();

  // A row: [pill] title ........ right-text  (title wraps)
  function headRow(pillText, tone, title, right, w, { size = 10 } = {}) {
    const pb = upper(pillText), pw = pb ? pillW(pb) + 8 : 0;
    const rb = right ? toBytes(right) : "", rw = rb ? textW(rb, false, 8) + 10 : 0;
    const lines = wrap(toBytes(title), true, size, w - pw - rw);
    const lead = size * 1.4;
    return {
      h: Math.max(lines.length * lead, 14),
      draw(p, x, y) {
        if (pb) drawPill(p, x, y + 1, pb, tone);
        lines.forEach((l, i) => p.text(l, x + pw, y + lead * 0.78 + i * lead, { bold: true, size, color: C.ink }));
        if (rb) p.text(rb, x + w - rw + 10, y + lead * 0.78, { size: 8, color: C.faint });
      },
    };
  }

  // A labelled field: LABEL then paragraph / bullets / links
  function field(f, w) {
    const atoms = [lineAtom(toBytes(f.label).toUpperCase(), { bold: true, size: 7, color: C.faint, lead: 11 })];
    if (f.text != null) atoms.push(...para(f.text, w, { size: 9, color: C.ink, lead: 12.2 }));
    if (f.items) f.items.forEach((t) => atoms.push(...bullet(t, w, { size: 9 })));
    if (f.links) f.links.forEach((l) => atoms.push(linkAtom(l.label, l.url, w)));
    atoms.push(spacer(5));
    return atoms;
  }
  function bullet(str, w, { size = 9.5, color = C.ink, marker = "•" } = {}) {
    const lead = size * 1.4, ind = 11;
    const lines = wrap(toBytes(str), false, size, w - ind);
    return lines.map((l, i) => ({
      h: lead,
      draw(p, x, y) {
        if (i === 0) p.text(toBytes(marker), x + 1, y + lead * 0.76, { size, color: C.faint });
        p.text(l, x + ind, y + lead * 0.76, { size, color });
      },
    }));
  }
  function linkAtom(label, url, w) {
    const lb = toBytes(label), ub = toBytes(url);
    const uLines = wrap(ub, false, 7, w);
    return {
      h: 11.5 + uLines.length * 9.2,
      draw(p, x, y) {
        p.text(lb, x, y + 9, { bold: true, size: 9, color: C.brand });
        const lw = textW(lb, true, 9);
        if (/^https:\/\//.test(url)) p.link(x, y, Math.min(lw, w), 12, url);
        uLines.forEach((l, i) => p.text(l, x, y + 19 + i * 9.2, { size: 7, color: C.faint }));
      },
    };
  }

  // A bordered card around several atoms.
  const card = (atoms, { pad = 9, after = 8, bg = null, border = C.line, bar = null } = {}) => ({ card: true, atoms, pad, after, bg, border, bar });

  // ---------------------------------------------------------------- blocks -> items
  function items(block) {
    switch (block.t) {
      case "title": {
        const out = [lineAtom(toBytes(block.text), { bold: true, size: 21, color: C.ink, lead: 27 }), lineAtom(toBytes(block.site || ""), { bold: true, size: 13, lead: 18 })];
        out.push(...para(block.site ? "" : "", CW).slice(0, 0));
        (block.lines || []).forEach((t) => out.push(...para(t, CW, { size: 8.5, color: C.faint, lead: 11.5 })));
        out.push(spacer(10));
        return out;
      }
      case "hero": return [heroAtom(block)];
      case "h2": return [Object.assign(headingAtom(block.text), { keep: 2 })];
      case "h3": return [Object.assign(lineAtom(toBytes(block.text).toUpperCase(), { bold: true, size: 7.5, color: C.faint, lead: 14 }), { keep: 1 })];
      case "p": return [...para(block.text, CW, { size: block.size || 9.5, color: block.color === "faint" ? C.faint : block.color === "mute" ? C.mute : C.ink, bold: !!block.bold, lead: (block.size || 9.5) * 1.42 }), spacer(block.gap == null ? 5 : block.gap)];
      case "bullets": {
        const out = [];
        block.items.forEach((t, i) => out.push(...bullet(t, CW, { marker: block.numbered ? `${i + 1}.` : "•", size: block.size || 9.5 })));
        out.push(spacer(6));
        return out;
      }
      case "note": {
        const [bg, fg] = block.tone === "warn" ? ["#FEF0C7", "#93370D"] : [C.bg, C.mute];
        const inner = para(block.text, CW - 20, { size: 8.5, color: fg, lead: 11.8 });
        return [card(inner, { pad: 8, bg, border: bg, after: 8 })];
      }
      case "issue": {
        const inner = [headRow(block.sev, block.sev, block.title, block.count, CW - 18)];
        inner.push(spacer(3));
        (block.fields || []).forEach((f) => inner.push(...field(f, CW - 18)));
        if (block.note) inner.push(...para(block.note.text, CW - 18, { size: 8.3, color: C.mute, lead: 11.4, gap: 3 }));
        return [card(inner)];
      }
      case "law": {
        const inner = [headRow(block.label, block.verdict, block.name, block.tag, CW - 18)];
        inner.push(spacer(3));
        (block.fields || []).forEach((f) => inner.push(...field(f, CW - 18)));
        if (block.note) inner.push(...para(block.note, CW - 18, { size: 8.3, color: C.mute, lead: 11.4, gap: 3 }));
        return [card(inner)];
      }
      case "reg": {
        const inner = [headRow(block.label, block.verdict, block.name, block.region, CW - 18)];
        inner.push(spacer(3));
        (block.fields || []).forEach((f) => inner.push(...field(f, CW - 18)));
        if (block.note) inner.push(...para(block.note, CW - 18, { size: 8.3, color: C.mute, lead: 11.4, gap: 3 }));
        return [card(inner)];
      }
      case "lawrow": return [lawRow(block)];
      case "ticks": return [...tickRows(block.items), spacer(6)];
      case "regrow": return [regRow(block)];
      case "usp": return [...para(block.text, CW, { bold: true, size: 12, lead: 16, gap: 4 })];
      case "rule": return [{ h: 8, draw(p, x, y, w) { p.line(x, y + 4, x + w, y + 4); } }];
      case "space": return [spacer(block.h || 8)];
      default: return [];
    }
  }

  function headingAtom(text) {
    const b = toBytes(text);
    return { h: 30, draw(p, x, y, w) { p.text(b, x, y + 19, { bold: true, size: 13, color: C.ink }); p.line(x, y + 25, x + w, y + 25, { color: C.line, lw: 1.2 }); } };
  }

  function lawRow(b) {
    const pb = upper(b.pill), pw = pillW(pb) + 10 + 6;
    const lines = wrap(toBytes(b.names.join("  ·  ")), false, 8.8, CW - Math.max(pw, 96) - 4);
    const lead = 12.2;
    return {
      h: Math.max(lines.length * lead, 14) + 6,
      draw(p, x, y) {
        drawPill(p, x, y + 1, pb, b.tone);
        lines.forEach((l, i) => p.text(l, x + Math.max(pw, 96), y + lead * 0.78 + i * lead, { size: 8.8 }));
      },
    };
  }
  function regRow(b) {
    const pb = upper(b.pill), pw = pillW(pb) + 8;
    const lines = wrap(toBytes(b.text), false, 9, CW - pw);
    return {
      h: Math.max(lines.length * 12.4, 14) + 3,
      draw(p, x, y) { drawPill(p, x, y + 1, pb, b.tone); lines.forEach((l, i) => p.text(l, x + pw, y + 9.5 + i * 12.4, { size: 9 })); },
    };
  }
  // "Done right": two columns of ticks
  function tickRows(list) {
    const colW = CW / 2 - 6, rows = [];
    const wrapped = list.map((t) => wrap(toBytes(t), false, 8.8, colW - 14));
    for (let i = 0; i < wrapped.length; i += 2) {
      const a = wrapped[i], b = wrapped[i + 1] || [];
      const n = Math.max(a.length, b.length);
      rows.push({
        h: n * 11.6 + 3,
        draw(p, x, y) {
          [[a, 0], [b, 1]].forEach(([lines, col]) => {
            if (!lines.length) return;
            const cx = x + col * (colW + 12);
            p.line(cx + 1, y + 6, cx + 3.5, y + 8.5, { color: "#067647", lw: 1.2 }); p.line(cx + 3.5, y + 8.5, cx + 8, y + 3.5, { color: "#067647", lw: 1.2 });
            lines.forEach((l, k) => p.text(l, cx + 13, y + 8.5 + k * 11.6, { size: 8.8 }));
          });
        },
      });
    }
    return rows;
  }

  function heroAtom(b) {
    const factLines = [];
    (b.facts || []).forEach((f) => wrap(toBytes(f.text), !!f.bold, f.bold ? 10.5 : 8.5, CW - 120).forEach((l) => factLines.push({ l, bold: !!f.bold })));
    const factsH = factLines.reduce((s, f) => s + (f.bold ? 15 : 11.5), 0);
    const bars = b.bars || [];
    const h = Math.max(112, factsH + 8 + bars.length * 13.5 + 4);
    return {
      h: h + 6,
      draw(p, x, y, w) {
        const cx = x + 48, cy = y + 52, r = 40;
        p.arc(cx, cy, r, 0, Math.PI * 2 - 0.0001, { color: C.track, lw: 9, cap: 0 });
        const pct = Math.max(0, Math.min(100, b.score)) / 100;
        if (pct > 0) p.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct - 0.0001, { color: scoreFill(b.score), lw: 9, cap: 1 });
        const sb = toBytes(String(b.score));
        p.text(sb, cx - textW(sb, true, 30) / 2, cy + 6, { bold: true, size: 30, color: C.ink });
        const ob = toBytes("/ 100");
        p.text(ob, cx - textW(ob, false, 8) / 2, cy + 20, { size: 8, color: C.faint });
        let yy = y + 2;
        factLines.forEach((f) => { p.text(f.l, x + 112, yy + (f.bold ? 11 : 8.5), { bold: f.bold, size: f.bold ? 10.5 : 8.5, color: f.bold ? C.ink : C.mute }); yy += f.bold ? 15 : 11.5; });
        yy += 6;
        const tx = x + 112 + 96, tw = w - 112 - 96 - 30;
        bars.forEach((bar) => {
          p.text(toBytes(bar.name), x + 112, yy + 7.5, { size: 8.3, color: C.ink });
          p.rect(tx, yy + 1.5, tw, 6, { fill: C.track, r: 3 });
          if (bar.score > 0) p.rect(tx, yy + 1.5, Math.max(6, (tw * bar.score) / 100), 6, { fill: scoreFill(bar.score), r: 3 });
          const vb = toBytes(String(bar.score));
          p.text(vb, x + w - textW(vb, true, 8.3), yy + 7.5, { bold: true, size: 8.3, color: scoreInk(bar.score) });
          yy += 13.5;
        });
      },
    };
  }

  // ---------------------------------------------------------------- layout across pages
  const cardHeight = (c) => c.atoms.reduce((s, a) => s + a.h, 0) + 2 * c.pad;

  function layout(list) {
    const pages = [];
    let page, y;
    const fresh = () => { page = new Page(); pages.push(page); y = MT; };
    fresh();
    const place = (atom, x, w) => { if (y + atom.h > BOTTOM) fresh(); atom.draw(page, x, y, w); y += atom.h; };
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.card) {
        const h = cardHeight(it);
        if (h <= BOTTOM - MT) {
          if (y + h > BOTTOM) fresh();
          if (it.bg || it.border) page.rect(MX, y, CW, h, { fill: it.bg || undefined, stroke: it.border, lw: 0.8, r: 5 });
          let yy = y + it.pad;
          it.atoms.forEach((a) => { a.draw(page, MX + it.pad, yy, CW - 2 * it.pad); yy += a.h; });
          y += h + it.after;
        } else it.atoms.forEach((a) => place(a, MX, CW));          // too tall for one page: flow without a border
        continue;
      }
      if (it.keep) {
        let need = it.h;
        for (let k = 1; k <= it.keep && list[i + k]; k++) need += list[i + k].card ? cardHeight(list[i + k]) : list[i + k].h;
        if (y + need > BOTTOM && need < BOTTOM - MT) fresh();
      }
      place(it, MX, CW);
    }
    return pages;
  }

  // ---------------------------------------------------------------- file format
  function pdfDate(ts) {
    const d = new Date(ts), z = (n, l = 2) => String(n).padStart(l, "0");
    return `D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
  }

  function assemble(pages, meta) {
    const objs = [];
    const add = (s) => objs.push(s);
    add(null); add(null);                                     // 1 catalog, 2 page tree (filled in below)
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");          // 3
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");     // 4
    add(`<< /Title (${esc(toBytes(meta.title))}) /Author (UX Audit Buddy) /Producer (UX Audit Buddy) /Creator (UX Audit Buddy) /CreationDate (${pdfDate(meta.ts)}) >>`);  // 5
    const kids = [];
    pages.forEach((p) => {
      const stream = p.ops.join("\n");
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const contentId = objs.length;
      const annotIds = p.annots.map((a) => {
        add(`<< /Type /Annot /Subtype /Link /Rect [${a.rect.map(n2).join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${esc(a.url)}) >> >>`);
        return objs.length;
      });
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R` + (annotIds.length ? ` /Annots [${annotIds.map((i) => i + " 0 R").join(" ")}]` : "") + " >>");
      kids.push(objs.length + " 0 R");
    });
    objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  // doc = { title, footer, ts, blocks:[...] }  ->  Uint8Array (the .pdf file)
  function build(doc) {
    const list = [];
    doc.blocks.forEach((b) => list.push(...items(b)));
    const pages = layout(list);
    const foot = toBytes(doc.footer || "UX Audit Buddy report");
    pages.forEach((p, i) => {
      p.line(MX, PH - 36, PW - MX, PH - 36, { color: C.line, lw: 0.6 });
      p.text(foot.slice(0, 120), MX, PH - 25, { size: 7.5, color: C.faint });
      const pn = toBytes(`Page ${i + 1} of ${pages.length}`);
      p.text(pn, PW - MX - textW(pn, false, 7.5), PH - 25, { size: 7.5, color: C.faint });
    });
    return assemble(pages, { title: doc.title || "UX Audit Report", ts: doc.ts || Date.now() });
  }

  return { build, toBytes, textW, wrap, charW, CW, MX, PW, PH };
})();
