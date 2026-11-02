import type { ScoreBreakdown } from "../db/schema";

export type AiFactors = {
  relevance: number;
  hook: number;
  educational: number;
  storytelling: number;
  shortForm: number;
  reason: string;
};

type Metrics = {
  title: string;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function freshnessScore(publishedAt: string | null, now = Date.now()): number | null {
  if (!publishedAt) return null;
  const ageDays = (now - new Date(publishedAt).getTime()) / 86_400_000;
  return clamp(100 * Math.exp(-Math.max(ageDays, 0) / 60));
}

/** Likes and comments per view, on a log scale. Null when the channel hides those counts. */
export function engagementScore(metrics: Pick<Metrics, "viewCount" | "likeCount" | "commentCount">): number | null {
  if (!metrics.viewCount || metrics.likeCount === null) return null;
  const rate = (metrics.likeCount + (metrics.commentCount ?? 0) * 2) / metrics.viewCount;
  return clamp((Math.log10(Math.max(rate, 1e-4)) + 4) * 33);
}

const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []);

/** Highest title overlap with anything already made in this project, from 0 to 1. */
export function similarityToExisting(title: string, existing: string[]): number {
  const a = tokens(title);
  if (a.size === 0) return 0;
  return existing.reduce((best, other) => {
    const b = tokens(other);
    const overlap = [...a].filter((token) => b.has(token)).length;
    const union = new Set([...a, ...b]).size;
    return Math.max(best, union === 0 ? 0 : overlap / union);
  }, 0);
}

/**
 * The estimated content opportunity score. Factors the data can't support are null and are left
 * out of the weighted average, and `complete` records that so the UI can say the score is partial.
 * This estimates fit for this project. It doesn't predict how a video will perform.
 */
export function scoreVideo(metrics: Metrics, existingTitles: string[], ai: AiFactors | null): ScoreBreakdown {
  const similarity = similarityToExisting(metrics.title, existingTitles);
  const freshness = freshnessScore(metrics.publishedAt);
  const engagement = engagementScore(metrics);
  const aiReason = ai?.reason ?? "Add an OpenAI key to score this factor.";

  const factors: ScoreBreakdown["factors"] = [
    { key: "relevance", label: "Niche relevance", score: ai ? clamp(ai.relevance) : null, weight: 25, reason: aiReason },
    { key: "hook", label: "Hook potential", score: ai ? clamp(ai.hook) : null, weight: 15, reason: aiReason },
    { key: "shortForm", label: "Short-form suitability", score: ai ? clamp(ai.shortForm) : null, weight: 15, reason: aiReason },
    { key: "educational", label: "Educational value", score: ai ? clamp(ai.educational) : null, weight: 10, reason: aiReason },
    { key: "storytelling", label: "Storytelling potential", score: ai ? clamp(ai.storytelling) : null, weight: 10, reason: aiReason },
    {
      key: "engagement",
      label: "Engagement signals",
      score: engagement,
      weight: 10,
      reason: engagement === null ? "This video hides its counts." : "Likes and comments per view.",
    },
    {
      key: "freshness",
      label: "Freshness",
      score: freshness,
      weight: 10,
      reason: freshness === null ? "Publish date unavailable." : "Newer videos score higher.",
    },
    {
      key: "novelty",
      label: "New to this project",
      score: clamp(100 * (1 - similarity)),
      weight: 5,
      reason: similarity > 0.3 ? "Similar to a video you already made." : "Not similar to anything you already made.",
    },
  ];

  const known = factors.filter((factor) => factor.score !== null);
  const weight = known.reduce((sum, factor) => sum + factor.weight, 0);
  const total = weight === 0 ? 0 : clamp(known.reduce((sum, factor) => sum + (factor.score as number) * factor.weight, 0) / weight);
  return { total, complete: known.length === factors.length, factors };
}

export type RawHighlight = { start: number; end: number; title: string; hook: string; score: number; reason: string };
export type Segment = { start: number; end: number };

/**
 * Makes model-suggested clips safe to cut: snaps to sentence boundaries, enforces the duration
 * limits, stays inside the source and drops overlaps, keeping the higher score.
 */
export function normalizeHighlights(
  raw: RawHighlight[],
  segments: Segment[],
  limits: { minSeconds: number; maxSeconds: number; sourceSeconds: number },
): RawHighlight[] {
  const nearest = (time: number, edge: "start" | "end") =>
    segments.length === 0
      ? time
      : segments.reduce((best, segment) => (Math.abs(segment[edge] - time) < Math.abs(best - time) ? segment[edge] : best), segments[0][edge]);

  const fitted = raw.flatMap((clip) => {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.end <= clip.start) return [];
    const start = Math.max(nearest(clip.start, "start"), 0);
    let end = Math.min(nearest(clip.end, "end"), limits.sourceSeconds);
    if (end - start > limits.maxSeconds) {
      const inside = segments.filter((segment) => segment.end > start && segment.end - start <= limits.maxSeconds);
      end = inside.length > 0 ? inside[inside.length - 1].end : start + limits.maxSeconds;
    }
    if (end - start < limits.minSeconds) {
      const longer = segments.find((segment) => segment.end - start >= limits.minSeconds && segment.end - start <= limits.maxSeconds);
      if (!longer) return [];
      end = longer.end;
    }
    return [{ ...clip, start, end, score: clamp(clip.score) }];
  });

  const kept: RawHighlight[] = [];
  for (const clip of fitted.sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => clip.start < other.end && other.start < clip.end)) kept.push(clip);
  }
  return kept;
}
