import type { ResolvedBackdrops } from '../contract';

/**
 * Nothing to resolve.
 *
 * Every other module spends a stage here: the podcast reads its library, the
 * shorts channels search Openverse, download, rank and review. This one draws
 * its backdrops, so there is no search, no cache, no licence, no credit and no
 * network call in the whole picture step.
 *
 * It still exists because the contract asks for it, and because returning an
 * empty result explicitly is how the pipeline learns there is nothing to stage
 * - rather than the step being silently skipped somewhere upstream.
 */
export function resolveBackdrops(): Promise<ResolvedBackdrops> {
  return Promise.resolve({
    backdrops: new Map(),
    staging: { directories: {}, files: {} },
    imageSrcFor: () => '',
    summary: 'Bối cảnh được vẽ, không phải tìm - không có ảnh nào cần tải.',
  });
}
