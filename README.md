# UX Audit Buddy

Chrome extension (Manifest V3) that audits any web page for UX issues, strengths and USP, and exports a report.

## Run locally
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open any website, click the extension icon, then **Scan this page**.

## Progress
- [x] Step 1: project skeleton (manifest, popup, content script, service worker)
- [x] Step 2: rule-based UX checks (19 checks, scoring, issue list)
- [x] Step 3: UX laws, WCAG and regulations knowledge base with cited sources (researched 2026-11-21), plus 3 dark-pattern heuristics
- [x] Step 3b: applicability engine (which rules apply to this site, with evidence and what to confirm)
- [x] Step 3c: UX laws & heuristics scorecard (10 measured with stated proxies, 6 flagged for human/AI review)
- [ ] Step 4: AI layer (USP, strengths, deeper reasoning) via a small backend
- [ ] Step 5: downloadable report (PDF) and audit history
