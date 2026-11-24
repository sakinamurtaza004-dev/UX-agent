// The "Or ask your own AI chat" card, shared by the side panel and the report page.
// Nothing is sent by the extension: it copies a prompt and opens the chat tab.
//
// getRecord():       returns the audit record to describe
// getPageContent():  optional; returns { text, metaDescription, headings } (live scans only,
//                    because saved reports deliberately don't keep page text)
// onToast(text):     optional; shows a short message (the panel passes its toast)

function renderChatPanel({ getRecord, getPageContent, onToast, intro }) {
  const card = el("div", { class: "cp", id: "chat-panel" });
  const uid = "cp" + Math.random().toString(36).slice(2, 7);

  const provider = el("select", { id: uid + "p", class: "cp-fld" });
  CHAT_PROVIDERS.forEach((p) => provider.append(el("option", { value: p.id, text: p.name })));
  const custom = el("input", { type: "text", id: uid + "c", class: "cp-fld", placeholder: "https://your-ai.example.com/", spellcheck: "false" });
  const customRow = el("div", { hidden: "" }, el("label", { class: "cp-lab", for: uid + "c", text: "Address of your AI chat" }), custom);
  const task = el("select", { id: uid + "t", class: "cp-fld" });
  Object.entries(CHAT_TASKS).forEach(([id, t]) => task.append(el("option", { value: id, text: t.label })));
  const question = el("textarea", { id: uid + "q", class: "cp-fld", maxlength: String(CHAT_QUESTION_MAX), placeholder: "We sell to small clinics. Is the pricing page convincing?" });

  const hasPageText = typeof getPageContent === "function";
  const includeText = el("input", { type: "checkbox", id: uid + "i" });
  includeText.checked = true;
  const textRow = hasPageText
    ? el("label", { class: "cp-chk" }, includeText, el("span", { text: "Include the page's text so the AI can judge wording and USP" }))
    : el("p", { class: "cp-xs", text: "This copy has the findings only. Saved reports don't keep the page's text; scan the page again to include it." });

  const goBtn = el("button", { type: "button", class: "cp-btn cp-pri", id: "chat-go" });
  const copyBtn = el("button", { type: "button", class: "cp-btn", id: "chat-copy", text: "Copy only" });
  const status = el("div", { class: "cp-status", id: "chat-status", role: "status" });
  const previewBtn = el("button", { type: "button", class: "cp-lnk", id: "chat-prev-btn", "aria-expanded": "false" });
  const previewBox = el("div", { class: "cp-prev", id: "chat-preview", hidden: "" });
  const manual = el("div", { hidden: "", id: "chat-manual-box" },
    el("div", { class: "cp-warn", text: "Couldn't copy automatically. Click in the box, press Ctrl/Cmd+A then Ctrl/Cmd+C, and paste it into the chat." }),
    el("textarea", { class: "cp-fld", id: "chat-manual", readonly: "", rows: "6" }));

  card.append(
    el("div", { class: "cp-head" }, el("h3", { class: "cp-h", text: "Ask your own AI chat" }), el("span", { class: "cp-free", text: "Free" })),
    intro ? el("p", { class: "cp-intro", text: intro }) : null,
    el("p", { class: "cp-xs", text: "We copy a ready prompt and open the chat. You paste it in. Nothing is sent by the extension." }),
    el("label", { class: "cp-lab", for: uid + "p", text: "Open" }), provider, customRow,
    el("label", { class: "cp-lab", for: uid + "t", text: "What you want" }), task,
    el("label", { class: "cp-lab", for: uid + "q", text: "Your question (optional, not saved)" }), question,
    textRow,
    el("div", { class: "cp-row" }, goBtn, copyBtn),
    status, manual, previewBtn, previewBox);

  // One safety marker per card, so the preview matches what gets copied exactly.
  const nonce = randomNonce();
  const options = () => ({
    nonce, task: task.value, question: question.value,
    ...(hasPageText && includeText.checked ? (() => { const c = getPageContent() || {}; return { pageText: c.text, metaDescription: c.metaDescription, headings: c.headings }; })() : {}),
  });
  const makePrompt = async () => buildChatPrompt(await getRecord(), options());
  const providerName = () => (CHAT_PROVIDERS.find((p) => p.id === provider.value) || {}).name || "chat";
  const sync = async () => {
    customRow.hidden = provider.value !== "custom";
    goBtn.textContent = provider.value === "custom" ? "Copy prompt and open chat" : `Copy prompt and open ${providerName()}`;
    previewBtn.textContent = previewBox.hidden ? "Preview exactly what will be copied" : "Hide the prompt";
    if (!previewBox.hidden) previewBox.textContent = await makePrompt();
  };
  const save = () => AuditStore.setPrefs({ chat: { provider: provider.value, customUrl: custom.value, task: task.value, includeText: includeText.checked } }).catch(() => {});
  const say = (t) => { status.textContent = t; if (onToast && t) onToast(t); };

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
      card.querySelector("#chat-manual").value = text;
      status.textContent = `Couldn't copy to the clipboard (${n} characters ready below).`;
    } else {
      say(open ? `Prompt copied. Opening ${providerName()}. Paste it in.` : "Prompt copied");
    }
    if (target) chrome.tabs.create({ url: target });
    save();
  }

  provider.addEventListener("change", () => { sync(); save(); });
  [task, includeText].forEach((n) => n.addEventListener("change", () => { sync(); save(); }));
  question.addEventListener("input", sync);
  custom.addEventListener("change", save);
  previewBtn.addEventListener("click", () => {
    previewBox.hidden = !previewBox.hidden;
    previewBtn.setAttribute("aria-expanded", String(!previewBox.hidden));
    sync();
  });
  goBtn.addEventListener("click", () => run(true));
  copyBtn.addEventListener("click", () => run(false));

  sync();
  // Restore the user's last choices.
  AuditStore.prefs().then((p) => {
    const c = p.chat || {};
    if (CHAT_PROVIDERS.some((x) => x.id === c.provider)) provider.value = c.provider;
    if (CHAT_TASKS[c.task]) task.value = c.task;
    if (typeof c.customUrl === "string") custom.value = c.customUrl;
    if (typeof c.includeText === "boolean") includeText.checked = c.includeText;
    sync();
  }).catch(() => {});

  return card;
}
