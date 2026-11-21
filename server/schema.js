// SCHEMAS: what the extension may send us, and what we ask Claude to send back.
//
// The model's output is requested as structured JSON (so we never have to
// guess at free text), then CLIPPED and VALIDATED again before it is returned
// to the extension. Nothing the model or the website says is trusted.

import { z } from "zod";

// The six laws code can't judge. The AI gives its opinion on these.
export const LAW_IDS = ["proximity", "commonregion", "aesthetic", "cognitive", "serial", "tesler"];

// ---------- What we ask Claude to return ----------
// Kept to plain types (strings, enums, arrays) because structured-output
// schemas don't support length limits. Limits are applied in sanitizeReview().
export const ReviewSchema = z.object({
  summary: z.string(),
  usp: z.object({
    statement: z.string(),
    clarity: z.enum(["clear", "somewhat_clear", "unclear"]),
    confidence: z.enum(["high", "medium", "low"]),
    evidence: z.array(z.string()),
    improvement: z.string(),
  }),
  strengths: z.array(z.object({ title: z.string(), detail: z.string() })),
  weaknesses: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      severity: z.enum(["high", "medium", "low"]),
      fix: z.string(),
    })
  ),
  laws: z.array(
    z.object({
      id: z.enum(LAW_IDS),
      verdict: z.enum(["followed", "partly", "not", "unknown"]),
      reasoning: z.string(),
    })
  ),
  priorities: z.array(z.string()),
  limitations: z.string(),
});

// How we READ the answer: lenient about the law entries, so one odd entry
// (unknown id, odd verdict) is dropped by sanitizeReview() instead of
// throwing away an otherwise good review.
export const LenientReviewSchema = ReviewSchema.extend({
  laws: z.array(z.object({ id: z.string(), verdict: z.string(), reasoning: z.string() })),
});
const VERDICTS = ["followed", "partly", "not", "unknown"];

// ---------- What the extension may send us ----------
export const RequestSchema = z.object({
  url: z.string().max(2000),
  title: z.string().max(300),
  metaDescription: z.string().max(500).default(""),
  headings: z.array(z.string().max(200)).max(40).default([]),
  navLabels: z.array(z.string().max(80)).max(30).default([]),
  ctas: z.array(z.string().max(80)).max(20).default([]),
  text: z.string().max(12000),
  profileSummary: z.array(z.string().max(200)).max(20).default([]),
  failed: z
    .array(z.object({ title: z.string().max(200), severity: z.enum(["high", "medium", "low"]), count: z.number() }))
    .max(40)
    .default([]),
  passedCount: z.number().default(0),
  score: z.number().default(0),
  uxLaws: z
    .array(z.object({ name: z.string().max(100), verdict: z.string().max(30), evidence: z.string().max(300) }))
    .max(20)
    .default([]),
  // base64 JPEG/PNG of the first screen (optional)
  screenshot: z.string().max(5_500_000).optional(),
});

// ---------- Clean-up of the model's answer ----------
// Strip control characters and enforce sane lengths so a huge or weird answer
// can't break the popup. The popup also renders everything with textContent.
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, n);

export function sanitizeReview(r) {
  const seen = new Set();
  return {
    summary: clip(r.summary, 700),
    usp: {
      statement: clip(r.usp.statement, 300),
      clarity: r.usp.clarity,
      confidence: r.usp.confidence,
      evidence: r.usp.evidence.slice(0, 5).map((e) => clip(e, 240)),
      improvement: clip(r.usp.improvement, 400),
    },
    strengths: r.strengths.slice(0, 6).map((s) => ({ title: clip(s.title, 120), detail: clip(s.detail, 500) })),
    weaknesses: r.weaknesses.slice(0, 6).map((w) => ({
      title: clip(w.title, 120),
      detail: clip(w.detail, 500),
      severity: w.severity,
      fix: clip(w.fix, 400),
    })),
    laws: r.laws
      .filter((l) => LAW_IDS.includes(l.id) && VERDICTS.includes(l.verdict) && !seen.has(l.id) && seen.add(l.id))
      .map((l) => ({ id: l.id, verdict: l.verdict, reasoning: clip(l.reasoning, 500) })),
    priorities: r.priorities.slice(0, 3).map((p) => clip(p, 260)),
    limitations: clip(r.limitations, 500),
  };
}
