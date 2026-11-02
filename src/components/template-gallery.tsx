"use client";

import { StatusPill } from "@/components/kit";
import { TimelinePlayer } from "@/components/timeline-player";
import { buildFacelessTimeline, estimateWordTimings, TEMPLATES } from "@/timeline/build";
import type { TimelineSpec } from "@/timeline/spec";

const SAMPLE = "Mars has the tallest volcano in the solar system, about three times higher than Everest.";

/** A labeled design preview: sample text only, with no job or generated media behind it. */
function sampleSpec(template: (typeof TEMPLATES)[number]): TimelineSpec {
  const spec = buildFacelessTimeline({
    template,
    hook: "The tallest volcano",
    title: "The tallest volcano",
    brand: { brandPrimary: "#58D5C9", brandSecondary: "#77A9FF" },
    scenes: [{ id: "sample", narration: SAMPLE, narrationAssetId: "none", durationSeconds: 5, words: estimateWordTimings(SAMPLE, 5), visual: { type: "card" }, speaker: template.id === "podcast" ? "Host" : undefined }],
  });
  return { ...spec, tracks: { ...spec.tracks, narration: [] }, style: { ...spec.style, syntheticMediaDisclosure: false } };
}

export function TemplateGallery() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {TEMPLATES.map((template) => (
        <section key={template.id} className="rounded-lg border border-border bg-card p-3">
          <div className="mx-auto max-w-[240px]">
            <TimelinePlayer spec={sampleSpec(template)} assetUrls={{}} loop />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{template.name}</h2>
            <StatusPill>Design preview</StatusPill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
        </section>
      ))}
    </div>
  );
}
