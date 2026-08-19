import { Composition } from 'remotion';
import { ShortVideo } from './ShortVideo';
import { TimelineSchema, type Timeline } from '../domain/timeline';
import { DEFAULT_VIDEO_CONFIG } from '../domain/config';
import sampleTimeline from './sample-timeline.json';

/**
 * Composition registry.
 *
 * `calculateMetadata` is what keeps spec §29's "do not hard-code the duration"
 * honest: the frame count comes from the timeline that was built against real
 * measured audio, so a 19-second narration produces a 19-second video without
 * anyone configuring anything.
 *
 * The zod parse here is a deliberate second gate. Node validates the timeline
 * before writing it, and this re-validates it after it has crossed into the
 * browser context - a malformed props payload fails at selectComposition with a
 * readable error instead of producing corrupt frames halfway through a render.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShortVideo"
      component={ShortVideo}
      // Placeholders only; calculateMetadata overrides all four from the props.
      width={DEFAULT_VIDEO_CONFIG.width}
      height={DEFAULT_VIDEO_CONFIG.height}
      fps={DEFAULT_VIDEO_CONFIG.fps}
      durationInFrames={1}
      defaultProps={{ timeline: sampleTimeline as unknown as Timeline }}
      calculateMetadata={({ props }) => {
        const timeline = TimelineSchema.parse(props.timeline);
        return {
          width: timeline.video.width,
          height: timeline.video.height,
          fps: timeline.video.fps,
          durationInFrames: timeline.video.durationInFrames,
          props: { timeline },
        };
      }}
    />
  );
};
