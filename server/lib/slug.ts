import { access } from 'node:fs/promises';
import { jobPaths, type AppConfig } from '../../src/config/env';

/** Ascii kebab-case project id from a Vietnamese display name. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || 'du-an';
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
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}
