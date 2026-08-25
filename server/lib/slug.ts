import { access } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../../src/config/env';
import { isValidSlug, slugify as sharedSlugify } from '../../src/utils/slug';

/** Project ids use the shared slug rules, so the CLI and the UI agree. */
export function slugify(name: string): string {
  return sharedSlugify(name, 'du-an');
}

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

/** Appends -2, -3, ... until the id is free under runtime/jobs. */
export async function uniqueProjectId(config: AppConfig, base: string): Promise<string> {
  let id = base;
  let n = 2;
  while (await exists(jobPaths(config.jobsDir, id).root)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** Same charset slugify() produces - used to reject unsafe ids in URLs. */
export function isValidProjectId(id: string): boolean {
  return isValidSlug(id);
}
