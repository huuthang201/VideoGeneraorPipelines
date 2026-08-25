import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../../src/config/env';
import type { ModuleId } from '../../src/domain/config';
import type { StepId } from './runState';

/**
 * What a step shows when you open it.
 *
 * Every box on the pipeline row is backed by an artefact the run actually left
 * on disk - a brief, a storyboard, a timeline, an audio file, a publishing kit.
 * This reads whichever of them belongs to the step being asked about, so the
 * screen can show the *work* rather than only a status light.
 *
 * All of it is read fresh on request rather than held in memory: these files
 * are small, they are the durable record, and a step opened an hour after the
 * run should show what is on disk now - including the edits someone made by
 * hand afterwards.
 */

export interface StepDetail {
  step: StepId;
  /** Shape depends on the step; the screen switches on `step`. */
  data: unknown;
}

const readJson = async <T>(file: string): Promise<T | null> => {
  const raw = await readFile(file, 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

interface TimelineFile {
  video: { width: number; height: number; fps: number; durationInFrames: number };
  scenes: {
    id: string;
    title: string;
    durationInFrames: number;
    background: {
      src: string;
      width: number;
      height: number;
      fit: string;
      credit: {
        label: string;
        creator: string;
        license: string;
        licenseUrl: string;
        sourceUrl: string;
      } | null;
    };
  }[];
}

export async function readStepDetail(
  module: ModuleId,
  config: AppConfig,
  projectId: string,
  step: StepId,
): Promise<StepDetail> {
  const paths = jobPaths(config.jobsDir, projectId);
  const data = await readFor(module, config, paths, projectId, step);
  return { step, data };
}

async function readFor(
  module: ModuleId,
  config: AppConfig,
  paths: ReturnType<typeof jobPaths>,
  projectId: string,
  step: StepId,
): Promise<unknown> {
  switch (step) {
    case 'brief':
      return readJson(paths.briefJson);

    case 'storyboard': {
      const storyboard = await readJson<{
        project: { episodeTitle: string };
        content: { summary: string; narration: string; imageQueries?: string[] };
        publish?: { title: string; description: string; tags: string[] };
        scenes: Record<string, unknown>[];
      }>(paths.storyboardJson);
      if (!storyboard) return null;
      return {
        episodeTitle: storyboard.project.episodeTitle,
        summary: storyboard.content.summary,
        imageQueries: storyboard.content.imageQueries ?? null,
        wordCount: storyboard.content.narration.split(/\s+/).filter(Boolean).length,
        scenes: storyboard.scenes,
      };
    }

    case 'images': {
      const timeline = await readJson<TimelineFile>(paths.timelineJson);
      if (!timeline) return null;
      /*
       * The picture for each scene, resolved back to something servable.
       *
       * The timeline's `src` points into the Remotion bundle, which is deleted
       * after a render - so the basename is looked up in whichever store the
       * module actually keeps: an uploaded library, or the search cache.
       */
      return {
        scenes: timeline.scenes.map((scene) => ({
          sceneId: scene.id,
          title: scene.title,
          filename: path.basename(scene.background.src),
          url: `/media/${module}/${projectId}/scene/${encodeURIComponent(path.basename(scene.background.src))}`,
          width: scene.background.width,
          height: scene.background.height,
          fit: scene.background.fit,
          credit: scene.background.credit,
          seconds: scene.durationInFrames / timeline.video.fps,
        })),
      };
    }

    case 'voice': {
      const [job, words, narration, captions] = await Promise.all([
        readJson<{ voice: string | null; devMock: boolean }>(paths.jobJson),
        readJson<unknown[]>(path.join(paths.audio, 'words.json')),
        readFile(path.join(paths.audio, 'narration.txt'), 'utf8').catch(() => null),
        readFile(paths.captionsSrt, 'utf8').catch(() => null),
      ]);
      const timeline = await readJson<TimelineFile>(paths.timelineJson);
      return {
        voice: job?.voice ?? null,
        devMock: job?.devMock ?? false,
        wordTimings: words?.length ?? 0,
        seconds: timeline ? timeline.video.durationInFrames / timeline.video.fps : null,
        narration,
        // Enough to see it worked, not the whole file - a ten-minute episode's
        // subtitles are thousands of lines nobody reads in a panel.
        captionsHead: captions ? captions.split('\n').slice(0, 40).join('\n') : null,
        audioUrl: `/media/${module}/${projectId}/voice.mp3`,
      };
    }

    case 'render': {
      const [timeline, progress, job] = await Promise.all([
        readJson<TimelineFile>(paths.timelineJson),
        readJson<{ renderedFrames: number; totalFrames: number }>(paths.progressJson),
        readJson<{ durationSeconds: number | null; devMock: boolean }>(paths.jobJson),
      ]);
      return {
        width: timeline?.video.width ?? null,
        height: timeline?.video.height ?? null,
        fps: timeline?.video.fps ?? null,
        frames: timeline?.video.durationInFrames ?? null,
        scenes: timeline?.scenes.length ?? null,
        seconds: timeline ? timeline.video.durationInFrames / timeline.video.fps : null,
        renderSeconds: job?.durationSeconds ?? null,
        devMock: job?.devMock ?? false,
        progress,
        videoUrl: `/media/${module}/${projectId}/video.mp4`,
      };
    }

    case 'check': {
      const job = await readJson<{
        status: string;
        durationSeconds: number | null;
        scenes: number | null;
        devMock: boolean;
        error: { stage: string; code: string; message: string } | null;
      }>(paths.jobJson);
      const timeline = await readJson<TimelineFile>(paths.timelineJson);
      return {
        status: job?.status ?? null,
        error: job?.error ?? null,
        devMock: job?.devMock ?? false,
        expected: timeline
          ? {
              width: timeline.video.width,
              height: timeline.video.height,
              seconds: timeline.video.durationInFrames / timeline.video.fps,
            }
          : null,
        thumbnails: ['thumbnail.jpg', 'thumbnail-2.jpg', 'thumbnail-3.jpg'].map((name) => ({
          name,
          url: `/media/${module}/${projectId}/${name}`,
        })),
      };
    }

    case 'upload': {
      const [kit, upload, meta] = await Promise.all([
        readJson<{
          title: string;
          description: string;
          tags: string[];
          chapters?: { label: string; timecode: string }[];
          images?: { creator: string; license: string; sourceUrl: string }[];
        }>(path.join(paths.output, 'youtube.json')),
        readJson<{
          url: string;
          privacyStatus: string;
          publishAt?: string;
          channel?: { title: string; url: string };
          thumbnailError?: string;
        }>(path.join(paths.output, 'youtube-upload.json')),
        readJson<{ autoPublish: string }>(path.join(paths.root, 'meta.json')),
      ]);
      return { kit, upload, autoPublish: meta?.autoPublish ?? 'none', configured: Boolean(config.youtube.clientId) };
    }
  }
}
