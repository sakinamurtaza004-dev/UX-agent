// UX AUDIT BUDDY: BACKEND
//
// Why this exists: the AI key must never live inside the browser extension
// (anyone could read it). The extension sends page data HERE, this server adds
// the secret key and talks to the AI, and returns the answer.
//
// Run:  npm install  ->  copy .env.example to .env and add your key  ->  npm start
// Try the UI without a key:  npm run mock
//
// Safeguards: binds to localhost by default, optional shared token, per-client
// and daily limits, request size cap, strict input validation, no page content
// is ever logged or stored.

import http from "node:http";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { RequestSchema } from "./schema.js";
import { runReview, mockReview, ReviewError } from "./review.js";

try { process.loadEnvFile(); } catch { /* no .env file: fine */ }

export function loadConfig(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d);
  return {
    port: num(env.PORT, 8787),
    host: env.HOST || "127.0.0.1",
    model: env.MODEL || "claude-opus-5-5",
    effort: env.EFFORT || "medium",
    appToken: env.APP_TOKEN || "",
    ratePerHour: num(env.RATE_LIMIT_PER_HOUR, 10),
    maxPerDay: num(env.MAX_REVIEWS_PER_DAY, 100),
    maxBodyBytes: num(env.MAX_BODY_MB, 6.5) * 1024 * 1024,
    mock: env.MOCK === "1",
    useFallbacks: env.DISABLE_FALLBACKS !== "1",
    allowOrigins: (env.ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    // Public (internet) deployment
    publicMode: env.PUBLIC_MODE === "1",
    allowExtensionIds: (env.ALLOW_EXTENSION_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    ipRatePerHour: num(env.IP_RATE_LIMIT_PER_HOUR, 30),
    trustProxy: env.TRUST_PROXY === "1",
  };
}

// Refuse to start in a configuration that is unsafe for the internet.
export function validateConfig(config) {
  const errors = [];
  if (config.publicMode) {
    if (!config.allowExtensionIds.length) errors.push("PUBLIC_MODE=1 needs ALLOW_EXTENSION_IDS (the ID(s) of your published extension), so other extensions and websites can't use your server.");
    if (!config.trustProxy) errors.push("PUBLIC_MODE=1 needs TRUST_PROXY=1 (the server must sit behind your host's HTTPS proxy so per-user limits see real addresses).");
    if (config.maxPerDay > 5000) errors.push("MAX_REVIEWS_PER_DAY is very high for a public server. Lower it so a bug or abuse can't run up a large bill.");
  }
  return errors;
}

export function createApp({ client, config, log = console.log }) {
  const hits = new Map(); // client key -> timestamps within the last hour
  let day = new Date().toISOString().slice(0, 10), dayCount = 0;

  // Which browser origins may call us? Any extension by default (local use);
  // only YOUR extension(s) once ALLOW_EXTENSION_IDS is set (public use).
  const originAllowed = (origin) => {
    if (!origin) return false;
    if (config.allowOrigins.includes(origin)) return true;
    if (!origin.startsWith("chrome-extension://")) return false;
    return !config.allowExtensionIds.length || config.allowExtensionIds.includes(origin.slice("chrome-extension://".length));
  };

  // The caller's address: behind a trusted proxy use the LAST X-Forwarded-For entry
  // (the one the proxy itself appended); otherwise the direct connection.
  const clientIp = (req) => {
    if (config.trustProxy) {
      const parts = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return req.socket.remoteAddress || "?";
  };

  function send(res, status, body, origin) {
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
    if (originAllowed(origin)) {
      headers["access-control-allow-origin"] = origin;
      headers["vary"] = "Origin";
    }
    if (status === 413) headers["connection"] = "close";
    res.writeHead(status, headers);
    // For "too large", close the connection only after the reply has been delivered.
    res.end(JSON.stringify(body), () => { if (status === 413) res.req.destroy(); });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      let over = false;
      req.on("data", (c) => {
        size += c.length;
        if (over) return; // discard the rest: nothing more is kept in memory
        if (size > config.maxBodyBytes) {
          over = true;
          reject(new ReviewError(413, "too_large", "That page's data is too large."));
        } else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  // Each request counts against several buckets (this install, this address).
  // Install ids are easy to fake, so they are a speed bump, not security. The
  // address limit, the daily cap and your Anthropic spend limit are the real brakes.
  function overLimit(buckets) {
    const now = Date.now();
    const pruned = buckets.map(({ key, limit }) => ({ key, limit, recent: (hits.get(key) || []).filter((t) => now - t < 3_600_000) }));
    const hit = pruned.find((b) => b.recent.length >= b.limit);
    if (hit) { pruned.forEach((b) => hits.set(b.key, b.recent)); return "hour"; }
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; dayCount = 0; }
    if (dayCount >= config.maxPerDay) return "day";
    pruned.forEach((b) => { b.recent.push(now); hits.set(b.key, b.recent); });
    dayCount++;
    // Keep memory bounded.
    if (hits.size > 5000) for (const [k, arr] of hits) if (!arr.some((t) => now - t < 3_600_000)) hits.delete(k);
    return null;
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const started = Date.now();
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "OPTIONS") {
        const h = { "access-control-max-age": "600" };
        if (originAllowed(origin)) {
          h["access-control-allow-origin"] = origin;
          h["access-control-allow-methods"] = "GET, POST, OPTIONS";
          h["access-control-allow-headers"] = "content-type, x-app-token, x-install-id";
          h["vary"] = "Origin";
        }
        res.writeHead(204, h);
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, mock: config.mock, model: config.mock ? null : config.model, tokenRequired: !!config.appToken, public: config.publicMode }, origin);
      }

      if (req.method === "POST" && url.pathname === "/api/review") {
        if (config.allowExtensionIds.length && !originAllowed(origin)) {
          return send(res, 403, { error: "forbidden", message: "This server only accepts requests from the UX Audit Buddy extension." }, origin);
        }
        if (config.appToken && req.headers["x-app-token"] !== config.appToken) {
          return send(res, 401, { error: "unauthorized", message: "Wrong or missing app token." }, origin);
        }
        const installId = /^[A-Za-z0-9-]{8,64}$/.test(String(req.headers["x-install-id"] || "")) ? String(req.headers["x-install-id"]) : "";
        const ip = clientIp(req);
        const buckets = [{ key: "ip:" + ip, limit: installId ? config.ipRatePerHour : config.ratePerHour }];
        if (installId) buckets.push({ key: "inst:" + installId, limit: config.ratePerHour });
        const limited = overLimit(buckets);
        if (limited) {
          return send(res, 429, { error: "rate_limited", message: limited === "day" ? "Daily review limit reached." : "Too many reviews this hour. Try again later." }, origin);
        }

        let json;
        try { json = JSON.parse(await readBody(req)); } catch (e) {
          if (e instanceof ReviewError) throw e;
          return send(res, 400, { error: "bad_json", message: "Request body must be JSON." }, origin);
        }
        const parsed = RequestSchema.safeParse(json);
        if (!parsed.success) {
          return send(res, 400, { error: "invalid_request", message: "Some fields were missing or too long.", fields: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, origin);
        }

        if (config.mock) {
          log(`[review] 200 ${Date.now() - started}ms MOCK`);
          return send(res, 200, { review: mockReview(), mock: true }, origin);
        }

        const { review, usage, servedBy } = await runReview(client, parsed.data, {
          model: config.model, effort: config.effort, useFallbacks: config.useFallbacks, log,
        });
        // Log numbers only, never page content.
        log(`[review] 200 ${Date.now() - started}ms model=${servedBy} in=${usage?.input_tokens} out=${usage?.output_tokens}`);
        return send(res, 200, { review, mock: false, servedBy }, origin);
      }

      return send(res, 404, { error: "not_found", message: "Unknown route." }, origin);
    } catch (err) {
      let status = 500, code = "server_error", message = "Something went wrong on the server.";
      if (err instanceof ReviewError) { status = err.status; code = err.code; message = err.message; }
      else if (err instanceof Anthropic.AuthenticationError) { status = 500; code = "server_key_invalid"; message = "The server's Anthropic API key was rejected. Check the key in server/.env."; }
      else if (err instanceof Anthropic.PermissionDeniedError) { status = 500; code = "server_key_forbidden"; message = "The server's API key isn't allowed to use this model."; }
      else if (err instanceof Anthropic.RateLimitError) { status = 429; code = "ai_rate_limited"; message = "The AI service is busy or over its limit. Try again shortly."; }
      else if (err instanceof Anthropic.APIConnectionError) { status = 502; code = "ai_unreachable"; message = "The server couldn't reach the AI service."; }
      else if (err instanceof Anthropic.APIError) { status = 502; code = "ai_error"; message = `The AI service returned an error (${err.status}).`; }
      log(`[review] ${status} ${Date.now() - started}ms ${code}`);
      if (!res.headersSent) send(res, status, { error: code, message }, origin);
    }
  });
}

// Start the server when run directly (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const config = loadConfig();
  if (!config.mock && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("\nNo ANTHROPIC_API_KEY found.\n  1. Copy .env.example to .env\n  2. Put your key in it\n  3. Run npm start again\n\nOr run `npm run mock` to try the extension with sample data.\n");
    process.exit(1);
  }
  const problems = validateConfig(config);
  if (problems.length) {
    console.error("\nUnsafe configuration:\n - " + problems.join("\n - ") + "\n");
    process.exit(1);
  }
  const client = config.mock ? null : new Anthropic();
  const server = createApp({ client, config });
  // Containers stop with SIGTERM: finish in-flight reviews, then exit.
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  server.listen(config.port, config.host, () => {
    console.log(`UX Audit Buddy server on http://${config.host}:${config.port}  (${config.mock ? "MOCK mode: sample data, no AI calls" : "model " + config.model + ", effort " + config.effort})`);
    if (config.host !== "127.0.0.1" && !config.appToken && !config.publicMode) console.warn("WARNING: listening beyond localhost without APP_TOKEN. Set APP_TOKEN in .env.");
  });
}
