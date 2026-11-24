// Small inline SVG icons (stroke style), built with createElementNS so they are
// real SVG nodes. No external icon font or image requests.
const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
  logo: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "M20 20l-4.6-4.6" }], ["path", { d: "M7.8 10.6l1.9 1.9 3.4-3.6" }]],
  history: [["path", { d: "M3 12a9 9 0 1 0 3-6.7L3 8" }], ["path", { d: "M3 3v5h5" }], ["path", { d: "M12 7v5l3 2" }]],
  settings: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" }]],
  rescan: [["path", { d: "M21 12a9 9 0 1 1-2.6-6.4L21 8" }], ["path", { d: "M21 3v5h-5" }]],
  chevDown: [["path", { d: "M6 9l6 6 6-6" }]],
  chevRight: [["path", { d: "M9 6l6 6-6 6" }]],
  check: [["path", { d: "M5 12l5 5 9-10" }]],
  lock: [["rect", { x: 3, y: 11, width: 18, height: 11, rx: 2 }], ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }]],
  chat: [["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }], ["path", { d: "M8 9h8M8 13h5" }]],
  close: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 8v5M12 16.5v.5" }]],
};

// icon("check", 14, "#067647", 2.4): decorative by default (aria-hidden).
function icon(name, size = 16, color = "currentColor", strokeWidth = 1.8) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", color);
  svg.setAttribute("stroke-width", strokeWidth);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attrs] of ICONS[name] || []) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}
