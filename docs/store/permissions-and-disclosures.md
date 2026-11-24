# Permissions and Chrome Web Store disclosures (draft)

You will be asked to justify each permission and to fill in the **Privacy practices** tab when you submit. These are draft answers based on what the code actually does. **Check each one is still true for the version you upload.** I can't make legal certifications for you.

## Permissions (from `manifest.json`)

| Permission | Plain-language justification to paste |
|---|---|
| `activeTab` | "The extension audits the page the user is viewing. It needs temporary access to that single tab, granted when the user opens the extension on it, to read the page's structure and (optionally) capture a screenshot of it for the AI review. It does not access any other tab or any site in the background." |
| `scripting` | "Used to run the extension's own analysis script (`content/scanner.js`, shipped inside the package) in the tab the user chose to audit. No remote code is loaded." |
| `storage` | "Saves the user's audit history, report preferences and settings locally in the browser. Nothing is synced or uploaded." |
| `sidePanel` | "The extension's interface is a side panel that stays open next to the page while the user browses. This permission lets the toolbar icon open it." |

**Clipboard:** the "Ask your own AI chat" feature copies a prompt when the user clicks a button. Chrome allows this from the extension's own page on a user click, so no clipboard permission is requested (tested). If it is blocked, the prompt is shown in a box to copy by hand.

**Optional, per-site access (`optional_host_permissions`):** declared but NOT granted at install. Because a side panel stays open while the user moves between pages, Chrome's one-page-at-a-time `activeTab` grant can run out. If a scan is refused, the panel explains what to do and offers an **"Allow on this site"** button that asks Chrome for that single site only, after the user clicks it. Justification to paste: "Used only when the user explicitly allows the extension to audit a specific site after Chrome refused a scan. Requested one site at a time, on a button click." (If a reviewer objects to this, it can be removed: the panel then asks the user to click the toolbar icon on the page instead.)

**Not requested at install:** host permissions, `tabs`, `history`, `cookies`, `webRequest`, `downloads`, remote code, content scripts that run automatically on websites. If a reviewer asks why the extension can reach a review server without host permissions: it uses standard cross-origin requests that the server explicitly allows.

## Single purpose

"Audit the web page the user is viewing for usability, accessibility and manipulative-design issues, show the findings in a side panel (including highlighting the affected elements on the page), and save them as a printable report."

## Remote code

"No. All JavaScript ships inside the extension package."

## Privacy practices: draft answers (confirm them yourself)

**Data the extension handles:**

| Chrome category | Handled? | Notes |
|---|---|---|
| Personally identifiable information | No | Not collected on purpose. Page text could contain some if the user runs AI review on such a page (warned against) |
| Health, financial, authentication information | No | Same note |
| Personal communications | No | |
| Location | No | |
| Web history | Declare conservatively | The audited page's address (no query/fragment) is stored locally, and sent to the review server if the user runs the AI review |
| User activity | No | No tracking of clicks, keystrokes or browsing |
| **Website content** | **Only if the user chooses an optional AI feature** | (1) The optional AI review sends page text, headings, labels and an optional screenshot to a review server after explicit consent. (2) "Ask your own AI chat" copies a prompt (findings and optional page text) to the clipboard; the extension itself sends nothing, the user pastes it |

**Statements you will be asked to certify (only certify if true):**
- I do not sell or transfer user data to third parties, outside of approved use cases. *(The data goes to the AI processor in order to provide the feature the user asked for.)*
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** host `docs/privacy-policy.html` (see "Hosting the policy" below) and paste the address.

## Hosting the policy

The store needs a public web address. The simplest free option is **GitHub Pages**:
1. Fill in every highlighted placeholder in `docs/privacy-policy.html` and delete the yellow draft box.
2. On GitHub: repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/docs` → Save**.
3. After a minute the policy is at `https://<your-username>.github.io/<repo-name>/privacy-policy.html`. Open it to check, then paste that address into the store form.

(I couldn't enable Pages from my environment, so that step is yours.)
