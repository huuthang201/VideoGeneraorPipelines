import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { useMemo } from 'react';
import type { Timeline } from '../domain/timeline';
import { getTheme } from './themes/theme';
import { SceneRouter } from './SceneRouter';
import { SceneTransition } from './transitions/SceneTransition';
import { ProgressBar } from './components/ProgressBar';
import { buildSpeechIntervals, musicVolumeAtFrame } from './audio/ducking';
import './fonts';

/**
 * The single composition (spec §29). One component renders every product -
 * there is deliberately no per-product component, because the moment a video
 * needs bespoke JSX the model is writing code again (spec §59).
 *
 * Its only input is a Timeline. Note what is absent: no storyboard, no
 * `scene.duration` in seconds, no narration text. Everything has already been
 * resolved to integer frames upstream, so nothing here can drift out of sync
 * with the audio.
 */
export const ShortVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const theme = getTheme(timeline.style, timeline.module);

  const speechIntervals = useMemo(() => buildSpeechIntervals(timeline), [timeline]);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      {timeline.scenes.map((scene, index) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
          name={`${scene.type}:${scene.id}`}
        >
          <SceneTransition transition={scene.transition} theme={theme} isFirst={index === 0}>
            <SceneRouter scene={scene} theme={theme} />
          </SceneTransition>
        </Sequence>
      ))}

      {/*
        One continuous narration track (spec §15-16). Remotion mixes it against
        the music; no ffmpeg concat step is involved.
      */}
      {timeline.voice ? <Audio src={staticFile(timeline.voice.src)} volume={1} /> : null}

      {timeline.music ? (
        <Audio
          src={staticFile(timeline.music.src)}
          loop
          volume={(frame) =>
            musicVolumeAtFrame(speechIntervals, frame, fps) * timeline.music!.volume
          }
        />
      ) : null}

      <ProgressBar theme={theme} />
    </AbsoluteFill>
  );
};
