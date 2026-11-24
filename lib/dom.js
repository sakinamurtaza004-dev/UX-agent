// Tiny safe DOM helpers shared by the popup, report and history pages.
// Everything goes in with textContent (never innerHTML), so text copied from
// a website, or written by the AI, can't inject code into our pages.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

// Links come only from our own knowledge base (never from the audited page),
// and we still insist on https.
function link(label, url) {
  const a = el("a", { text: label });
  if (/^https:\/\//.test(url)) {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}
