// POPUP script: the little window that opens when you click the icon.
document.getElementById("scan").addEventListener("click", async () => {
  const out = document.getElementById("out");
  out.textContent = "Scanning...";
  try {
    // 1. Find the tab the user is looking at
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // 2. Inject our content script into that tab and get its result
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/scanner.js"],
    });
    out.textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    out.textContent = "Can't scan this page (Chrome blocks internal pages).\n" + e.message;
  }
});
