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
- [x] Step 4: AI review (USP, strengths/weaknesses, AI verdicts for the 6 unmeasured laws) via a small backend in `server/` (see `server/README.md`); issue cards now show UX laws
- [x] Step 5: full report (print to PDF, self-contained HTML, JSON), audit history on your device (last 50), before/after comparison

## Reports and history

After a scan, **Open full report** shows a complete document: score, issues with fixes, UX laws, AI review (if run), the rules that apply, and how to read it all.

- **PDF:** click *Print / Save as PDF*, then choose *Save as PDF* as the destination.
- **HTML:** a single self-contained file that works offline.
- **JSON:** the raw data.
- **History:** every audit is saved on your device only (the 50 most recent). Re-audit the same page later and the popup shows the score change; the History page shows what was fixed and what broke.
- Saved addresses drop the query string and #fragment (they can contain secrets). Sample data from mock mode is never saved as a real review. Switch history off any time.

## Getting ready to publish

Nothing here submits anything. See `docs/` and `scripts/`:

- `npm run build:store -- --no-ai-server` (or `--server https://your.host`) builds the zip to upload, after checking permissions, icons and code rules.
- `docs/privacy-policy.html`: draft policy with placeholders to fill in.
- `docs/store/permissions-and-disclosures.md` and `docs/store/listing.md`: store form answers and listing text.
- `server/HOSTING.md`: how to host the review server safely, and who pays for the AI.
