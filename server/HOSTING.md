> **Not used by the extension (v0.9.0 onward).** The extension now only offers the free "ask your own AI chat" hand-off and sends nothing to any server. This folder is kept for reference and is not shipped in the store package.

# Hosting the review server for real users

Running `npm start` on your own laptop is fine for you. Other people's extensions can't reach your laptop, so for a published extension the server must run on the internet, **and you pay for every review.** Read the cost and safety notes before you switch it on.

> **Decision (this project):** the first AI feature is **"Ask your own AI chat"**, which is free, needs no key and no server (already built). A bring-your-own-key mode comes later. This server is therefore **optional**: for development, self-hosters, or if you ever choose option A below.

## Decide first: who pays for the AI?

| Option | How it works | Trade-off |
|---|---|---|
| **A. You host it (this guide)** | Users click "Run AI review"; your server calls Claude with your key | Simplest for users. **You pay**, so you need limits now and probably a paid plan later |
| **B. Users bring their own key** | Each user pastes their own Anthropic key into the extension | No hosting cost for you. Harder for ordinary users, and keys are then stored in their browser (not built yet) |
| **C. Launch without AI** | The rule-based audit, UX laws, regulations, reports and history all work with no server | Zero running cost. The AI panel would be hidden or marked "coming soon" |

Option C costs nothing and can ship first. A and C can be combined later.

## Safety model (be honest with yourself)

A public extension **can't keep a secret**, so there is no password to protect the server. These layers limit damage instead:

1. **`ALLOW_EXTENSION_IDS`**: only your extension's origin is accepted by browsers. (A non-browser program can fake the origin, so this stops casual misuse, not a determined abuser.)
2. **Per-install limit** (`RATE_LIMIT_PER_HOUR`, default 10): a speed bump; install ids are easy to fake.
3. **Per-address limit** (`IP_RATE_LIMIT_PER_HOUR`, default 30): stops one machine rotating install ids.
4. **Global daily cap** (`MAX_REVIEWS_PER_DAY`, default 100): the hard ceiling on how many reviews your server will ever run in a day.
5. **Your Anthropic spend limit**: set it in the Console. This is the real last line of defence. Do this first.

At roughly "a few cents to ~10-15 cents" per review (see `README.md`), a 100-per-day cap is on the order of single-digit to low-double-digit dollars per day at worst. Choose the cap on purpose.

## Settings for a public server

Set these as environment variables on your host (never commit them):

```
ANTHROPIC_API_KEY=...            # secret
PUBLIC_MODE=1                    # refuses to start with unsafe settings
ALLOW_EXTENSION_IDS=<your id>    # the Chrome Web Store ID of your extension
TRUST_PROXY=1                    # you are behind the host's HTTPS proxy
MAX_REVIEWS_PER_DAY=100
RATE_LIMIT_PER_HOUR=10
IP_RATE_LIMIT_PER_HOUR=30
EFFORT=medium
```

`PUBLIC_MODE=1` makes the server **refuse to start** unless `ALLOW_EXTENSION_IDS` and `TRUST_PROXY=1` are set and the daily cap is sane.

**Getting your extension ID:** it is created when you first upload to the Chrome Web Store dashboard, so you can only fill in `ALLOW_EXTENSION_IDS` after that. Until then leave the AI server off (option C) or restrict it some other way.

## Deploying

The `Dockerfile` in this folder builds a small image. Any host that runs a container and gives you HTTPS works (for example Google Cloud Run, Fly.io, Render, Railway). General steps:

1. Create a service from this `server/` folder (or the built image).
2. Set the environment variables above, with `ANTHROPIC_API_KEY` as a *secret*.
3. Make sure you get an **https** address. The extension refuses to send page text to a non-localhost address that isn't https.
4. Visit `https://YOUR-ADDRESS/health`. You should see `{"ok":true,...,"public":true}`.
5. In the extension build (see the root README), set that address as the default server.

I haven't deployed to a real host, and I couldn't build the Docker image in the environment I worked in. Treat steps 1-4 as a checklist to verify yourself; the server code itself is tested (`npm test`).

## Privacy obligations

If you host the server, you are processing the page text users send. The server doesn't store or log page content, and the privacy policy in `docs/store/privacy-policy.md` is written on that basis. If you ever add logging, analytics or storage, **update the policy first.**

## Watching it

- Check the Anthropic Console usage page daily for the first weeks.
- Server logs show only timing, model and token counts.
- A `429` with "Daily review limit reached" means your cap worked.
