// The "Ask your own AI chat" panel, shared by the popup and the report page.
// Nothing is sent by the extension: it copies a prompt and opens the chat tab.
//
// getRecord():       returns the audit record to describe
// getPageContent():  optional; returns { text, metaDescription, headings } (popup only,
//                    because saved reports deliberately don't keep page text)

function renderChatPanel({ getRecord, getPageContent }) {
  const panel = el("div", { class: "chatpanel", id: "chat-panel" });
  panel.append(
    el("h2", { text: "Ask your own AI chat" }),
    el("div", { class: "caveat", text:
      "Free, and no key needed. The extension copies a ready-made prompt and opens the chat you pick; you paste it in. " +
      "The extension itself sends nothing, and what happens next is between you and that AI service." }));

  const provider = el("select", { id: "chat-provider" });
  CHAT_PROVIDERS.forEach((p) => provider.append(el("option", { value: p.id, text: p.name })));
  const custom = el("input", { type: "text", id: "chat-custom", placeholder: "https://your-ai.example.com/", spellcheck: "false" });
  const customRow = el("label", { class: "field", hidden: "" }, document.createTextNode("Address of your AI chat"), custom);
  const task = el("select", { id: "chat-task" });
  Object.entries(CHAT_TASKS).forEach(([id, t]) => task.append(el("option", { value: id, text: t.label })));
  const question = el("textarea", { id: "chat-question", rows: "2", maxlength: String(CHAT_QUESTION_MAX), placeholder: "Optional: your own question, e.g. 'We sell to small clinics. Is the pricing page convincing?'" });

  const includeText = el("input", { type: "checkbox", id: "chat-text" });
  const hasPageText = typeof getPageContent === "function";
  const textRow = hasPageText
    ? el("label", { class: "check" }, includeText, document.createTextNode(" Include the page's text (up to about 9,000 characters), so the AI can judge the wording and USP"))
    : el("div", { class: "caveat", text: "This copy contains the findings only. Saved reports don't keep the page's text; scan the page again from the popup to include it." });
  includeText.checked = true;

  const copyOpen = el("button", { class: "primary", id: "chat-go", text: "Copy prompt & open chat" });
  const copyOnly = el("button", { id: "chat-copy", text: "Copy only" });
  const status = el("div", { class: "aistatus", id: "chat-status" });
  const preview = el("textarea", { id: "chat-preview", readonly: "", rows: "8" });
  const previewBox = el("details", { class: "settings" }, el("summary", { text: "Preview exactly what will be copied" }), el("div", { class: "body" }, preview));
  const manual = el("div", { class: "manual", hidden: "" },
    el("div", { class: "warn", text: "Couldn't copy automatically. Click in the box, press Ctrl/Cmd+A then Ctrl/Cmd+C, and paste it into the chat." }),
    el("textarea", { id: "chat-manual", readonly: "", rows: "6" }));

  panel.append(
    el("label", { class: "field" }, document.createTextNode("Open this AI"), provider), customRow,
    el("label", { class: "field" }, document.createTextNode("What do you want from it?"), task),
    el("label", { class: "field" }, document.createTextNode("Your question (not saved)"), question),
    textRow,
    el("div", { class: "btnrow" }, copyOpen, copyOnly), status, manual, previewBox);

  // One safety marker per panel, so the preview matches what gets copied exactly.
  const nonce = randomNonce();
  const current = () => ({
    nonce,
    task: task.value,
    question: question.value,
    ...(hasPageText && includeText.checked ? (() => { const c = getPageContent() || {}; return { pageText: c.text, metaDescription: c.metaDescription, headings: c.headings }; })() : {}),
  });
  const makePrompt = async () => buildChatPrompt(await getRecord(), current());

  const refreshPreview = async () => {
    customRow.hidden = provider.value !== "custom";
    if (previewBox.open) { const t = await makePrompt(); preview.value = t; }
  };
  const save = () => AuditStore.setPrefs({ chat: { provider: provider.value, customUrl: custom.value, task: task.value, includeText: includeText.checked } }).catch(() => {});

  async function run(open) {
    status.textContent = "";
    manual.hidden = true;
    let target = null;
    if (open) {
      const prov = CHAT_PROVIDERS.find((p) => p.id === provider.value);
      const v = validateChatUrl(prov.id === "custom" ? custom.value : prov.url);
      if (!v.ok) { status.textContent = v.problem; return; }
      target = v.url;
    }
    const text = await makePrompt();
    const how = await copyText(text);
    const n = text.length.toLocaleString();
    if (how === "failed") {
      manual.hidden = false;
      $m("chat-manual").value = text;
      status.textContent = `Couldn't copy to the clipboard (${n} characters ready below).`;
    } else {
      status.textContent = `Copied ${n} characters.` + (open ? " Paste it into the chat (Ctrl/Cmd+V) once it opens." : " Paste it into your AI chat.");
    }
    if (target) chrome.tabs.create({ url: target });
    save();
  }
  const $m = (id) => panel.querySelector("#" + id);

  provider.addEventListener("change", () => { refreshPreview(); save(); });
  [task, question, includeText].forEach((n) => n.addEventListener("change", () => { refreshPreview(); save(); }));
  question.addEventListener("input", refreshPreview);
  previewBox.addEventListener("toggle", refreshPreview);
  custom.addEventListener("change", save);
  copyOpen.addEventListener("click", () => run(true));
  copyOnly.addEventListener("click", () => run(false));

  // Restore the user's last choices.
  AuditStore.prefs().then((p) => {
    const c = p.chat || {};
    if (CHAT_PROVIDERS.some((x) => x.id === c.provider)) provider.value = c.provider;
    if (CHAT_TASKS[c.task]) task.value = c.task;
    if (typeof c.customUrl === "string") custom.value = c.customUrl;
    if (typeof c.includeText === "boolean") includeText.checked = c.includeText;
    customRow.hidden = provider.value !== "custom";
  }).catch(() => {});

  return panel;
}
