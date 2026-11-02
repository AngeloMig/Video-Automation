import type { ComponentType } from "react";
import { Composition, registerRoot } from "remotion";
import { Timeline } from "./Timeline";
import { TIMELINE_FPS, TIMELINE_HEIGHT, TIMELINE_WIDTH, type TimelineProps } from "../timeline/spec";

const EMPTY_PROPS: TimelineProps = {
  assetUrls: {},
  spec: {
    version: 1,
    fps: TIMELINE_FPS,
    width: TIMELINE_WIDTH,
    height: TIMELINE_HEIGHT,
    durationInFrames: 30,
    tracks: { visual: [], narration: [], music: [], captions: [], text: [] },
    style: {
      template: "signal",
      brandPrimary: "#58D5C9",
      brandSecondary: "#77A9FF",
      syntheticMediaDisclosure: false,
      caption: {
        preset: "signal",
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
        fontSize: 68,
        textColor: "#F5F7FA",
        highlightColor: "#58D5C9",
        uppercase: false,
        positionY: 0.68,
        background: true,
      },
    },
  },
};

function Root() {
  return (
    <Composition
      id="Timeline"
      component={Timeline as unknown as ComponentType<Record<string, unknown>>}
      fps={TIMELINE_FPS}
      width={TIMELINE_WIDTH}
      height={TIMELINE_HEIGHT}
      durationInFrames={30}
      defaultProps={EMPTY_PROPS as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => ({
        durationInFrames: (props as unknown as TimelineProps).spec.durationInFrames,
      })}
    />
  );
}

registerRoot(Root);
