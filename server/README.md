# UX Audit Buddy: review server

A small program that runs **on your computer** (or later, on a host). The Chrome extension sends it the page's text, and it asks Claude for the AI review.

**Why not call Claude straight from the extension?** An API key inside an extension can be read by anyone who installs it. The key lives only in this server.

## 1. Try it with no key (sample data)

You need [Node.js](https://nodejs.org) 20.12 or newer.

```bash
cd server
npm install
npm run mock
```

In the extension: scan a page, tick the consent box, click **Run AI review**. You'll get clearly-labelled **SAMPLE DATA** (not a review of your page). This only proves the connection works.

## 2. Use the real AI

1. Create an account at <https://console.anthropic.com> and add a small amount of credit.
2. **Set a monthly spend limit** in the Console's billing/limits settings *before* you start. Do this first.
3. Create an API key in the Console. Copy it once; you can't view it again.
4. In the `server` folder:

```bash
cp .env.example .env
```

5. Open `.env` and paste the key after `ANTHROPIC_API_KEY=`. **Never share or commit this file.** (`.gitignore` already excludes it.)
6. Start the server:

```bash
npm start
```

You should see `UX Audit Buddy server on http://127.0.0.1:8787`. Leave that terminal open while you use the extension.

## What it costs

You pay Anthropic per use. The default model is `claude-opus-5-5`; the price table I checked listed it at $4 per million input tokens and $20 per million output tokens (cached 2026-11-03, so check the current price). A review sends a few thousand tokens of page text, optionally one screenshot, and the model "thinks" before answering. Expect roughly **a few cents up to about 10-15 cents per review**; check real usage in the Console after your first few runs. The server also caps you: `RATE_LIMIT_PER_HOUR` (default 10) and `MAX_REVIEWS_PER_DAY` (default 100).

To spend less: `EFFORT=low` in `.env`, or untick the screenshot in the extension.

## Safeguards

- Listens on **localhost only** by default.
- Accepts requests only from Chrome extensions (CORS); optional shared `APP_TOKEN`.
- Strict input validation and a 6.5 MB size cap.
- The AI's answer is checked and clipped before it reaches the extension, and the extension shows it as plain text only.
- Page text is wrapped as **untrusted data** in the prompt, so instructions hidden in a web page shouldn't be followed. (This reduces the risk; it can't be guaranteed.)
- **Nothing from your pages is logged or stored.** Logs show only timing, model and token counts.
- If Claude's safety system declines a request, the server automatically retries on a fallback model (the `fallbacks` option). Turn this off with `DISABLE_FALLBACKS=1`.

## Privacy: read before you click

When you run an AI review, the page's text and (if ticked) a screenshot go to this server and then to Anthropic's API. The page address is sent without its query string or #fragment. Don't run it on pages showing private information (email, banking, medical records, internal tools). The extension shows a warning on pages that look private, but it can't catch everything.

## Troubleshooting

| You see | Do this |
|---|---|
| "Can't reach the review server" | Is the server running? Run `npm start` in the `server` folder. The address in *Review server settings* must match (default `http://localhost:8787`). |
| "The server's Anthropic API key was rejected" | Check the key in `.env`, and that your Console account has credit. |
| "Too many reviews this hour" | Wait, or raise `RATE_LIMIT_PER_HOUR` in `.env` and restart. |
| "The AI declined to review this page" | Rare; try a different page. |
| No screenshot included | Chrome only allows screenshots right after you click the toolbar icon. Click the icon, scan, then run the review from the AI review tab. |

## Tests

```bash
npm test
```

Runs 18 checks against a **fake** Claude API: no key, no network, no cost. It checks the exact request sent to the API, the fallback behaviour and every safeguard above.

## Going live later (Step 6)

Deploy this server to a host, set `HOST`, `APP_TOKEN` and your real limits, then change the server address in the extension and add that address to `host_permissions` in `manifest.json`. The localhost entries should be removed before publishing to the Chrome Web Store.
