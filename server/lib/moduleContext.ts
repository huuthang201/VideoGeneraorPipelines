import type { Request } from 'express';
import { loadConfig, type AppConfig } from '../../src/config/env';
import { getModule, parseModuleId, type AnyVideoModule } from '../../src/modules';
import type { ModuleId } from '../../src/domain/config';

/**
 * Which pipeline a request is about.
 *
 * The server hosts both, and every API path carries the module: `/api/podcast/
 * projects`, `/api/fact/projects`. It is in the path rather than in a header or
 * a session because it decides which job directory is read, which cache is
 * written and which YouTube account is uploaded to - so it belongs somewhere
 * visible in a log and impossible to forget.
 *
 * Configuration is memoised per module rather than per request. Reading two
 * small files on every poll of a progress endpoint is wasteful, and `loadConfig`
 * is pure - it parses into a fresh object and never touches `process.env` - so
 * two modules can be held at once without either seeing the other's values.
 * Restarting the server is what picks up an edited `.env`, which was already
 * true before the merge.
 */
const configs = new Map<ModuleId, AppConfig>();

export function configFor(id: ModuleId): AppConfig {
  let config = configs.get(id);
  if (!config) {
    config = loadConfig(id);
    configs.set(id, config);
  }
  return config;
}

/**
 * The module named in the path, or a 400.
 *
 * Throws rather than defaulting: a request to an unknown module is a bug in the
 * page, and quietly serving the podcast's projects to a fact URL would be a
 * confusing way to find out.
 */
export function moduleFrom(req: Request): AnyVideoModule {
  const raw = req.params.module;
  return getModule(parseModuleId(Array.isArray(raw) ? raw[0] : raw));
}

/** Everything a router needs to serve one pipeline. */
export interface ModuleContext {
  module: AnyVideoModule;
  config: AppConfig;
}

export function contextFor(id: ModuleId): ModuleContext {
  return { module: getModule(id), config: configFor(id) };
}

export function contextFrom(req: Request): ModuleContext {
  const module = moduleFrom(req);
  return { module, config: configFor(module.id) };
}
