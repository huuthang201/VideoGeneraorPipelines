import { MODULE_IDS, type ModuleId } from '../domain/config';
import type { SceneLike, StoryboardLike, VideoModule } from './contract';
import { podcastModule } from './podcast';
import { factModule } from './fact';
import type { BaseBrief } from '../domain/brief';

export type { VideoModule, SceneLike, StoryboardLike } from './contract';

/**
 * The registry.
 *
 * Two pipelines in one repository, sharing about two thirds of their code. See
 * `contract.ts` for what a module owns and why.
 *
 * The type is deliberately widened here: each module is strongly typed in terms
 * of its own brief, scene and storyboard, and the shared pipeline sees only the
 * structural minimum. Narrowing back down is never needed - nothing outside a
 * module reaches into its extra fields.
 */
export type AnyVideoModule = VideoModule<BaseBrief, SceneLike, StoryboardLike<SceneLike>>;

const MODULES = {
  podcast: podcastModule as unknown as AnyVideoModule,
  fact: factModule as unknown as AnyVideoModule,
} satisfies Record<ModuleId, AnyVideoModule>;

export function getModule(id: ModuleId): AnyVideoModule {
  return MODULES[id];
}

export function listModules(): AnyVideoModule[] {
  return MODULE_IDS.map((id) => MODULES[id]);
}

/**
 * Turns a command-line or environment value into a module id.
 *
 * Strict, and with the valid values named in the error. There is no default:
 * defaulting would mean a mistyped `--module` quietly ran the wrong pipeline,
 * against the wrong runtime directory, and - because the two authorise
 * separately - uploaded to the wrong YouTube channel.
 */
export function parseModuleId(value: string | undefined): ModuleId {
  const found = MODULE_IDS.find((id) => id === value);
  if (!found) {
    throw new Error(
      `Unknown module ${JSON.stringify(value ?? '')}. Expected one of: ${MODULE_IDS.join(', ')}.`,
    );
  }
  return found;
}
