import type { Command } from 'commander';
import type { AppConfig } from '../../config/env';
import { createLogger, type Logger } from '../../utils/logger';
import { OpenverseProvider } from './image/stock/openverse.provider';
import { MIN_IMAGE_EDGE } from './image/stock/resolve';

/**
 * The fact module's own CLI commands.
 *
 * Registered only when the CLI is running as this module. `stock-search` has no
 * meaning for the podcast, whose photographs are uploaded rather than found.
 */
export function registerFactCommands(
  program: Command,
  loadModuleConfig: () => AppConfig,
  run: (fn: () => Promise<void>, logger: Logger) => Promise<void>,
): void {
  program
    .command('stock-search')
    .argument('<query>', 'search phrase, in English')
    .option('--limit <n>', 'how many results to show', (v) => Number.parseInt(v, 10), 8)
    .description('Show the photographs a scene query would find (no download, no render)')
    .action(async (query: string, opts: { limit: number }) => {
      const config = loadModuleConfig();
      const logger = createLogger({ level: config.logLevel });

      await run(async () => {
        const provider = new OpenverseProvider(config.stock.token, config.stock.sources);
        const results = await provider.search({
          query,
          limit: opts.limit,
          minEdge: MIN_IMAGE_EDGE,
        });

        if (results.length === 0) {
          logger.warn(
            `Nothing usable for "${query}". Every result was under ${MIN_IMAGE_EDGE}px or carried ` +
              'a licence this tool will not publish. Try fewer, more concrete words.',
          );
          return;
        }

        for (const image of results) {
          console.log(
            `${String(image.width).padStart(5)}x${String(image.height).padEnd(5)} ` +
              `${image.license.padEnd(4)} ${image.creator.slice(0, 28).padEnd(28)} ${image.sourceUrl}`,
          );
        }
        logger.done(`${results.length} usable result(s) for "${query}"`);
      }, logger);
    });

}
