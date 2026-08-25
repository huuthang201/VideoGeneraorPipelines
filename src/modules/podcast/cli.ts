import type { Command } from 'commander';
import type { AppConfig } from '../../config/env';
import { libraryPaths } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { createLogger } from '../../utils/logger';
import { COMFORTABLE_ENVIRONMENTS } from '../../domain/project';
import {
  importIntoLibrary,
  readLibrary,
  removeFromLibrary,
} from './image/library';

/**
 * The podcast module's own CLI commands.
 *
 * Registered only when the CLI is running as this module - see `--module` in
 * `src/cli/index.ts`. Genuinely absent rather than hidden under the other
 * module: there is no library there to list.
 */
export function registerPodcastCommands(
  program: Command,
  loadModuleConfig: () => AppConfig,
  run: (fn: () => Promise<void>, logger: Logger) => Promise<void>,
): void {
  /**
   * The shared backdrop library.
   *
   * Deliberately a separate noun from a project: these photographs belong to the
   * system, and every episode draws from them. Uploading one makes it available
   * to every project at once.
   */
  const library = program
    .command('library')
    .description('Manage the shared backdrop images');

  library
    .command('add-environments')
    .argument('<source>', 'folder of backdrop images')
    .description('Import backdrops into the shared library (additive)')
    .action(async (source: string) => {
      const config = loadModuleConfig();
      const logger = createLogger({ level: config.logLevel });

      await run(async () => {
        const result = await importIntoLibrary({
          paths: libraryPaths(config.libraryDir),
          sourceDir: source,
          onWarn: (message) => logger.warn(message),
        });
        logger.done(
          `Imported ${result.imported.length} backdrop(s); library now holds ` +
            `${result.library.counts.environment}`,
        );
      }, logger);
    });

  library
    .command('list')
    .description('Show the backdrops in the shared library')
    .action(async () => {
      const config = loadModuleConfig();
      const contents = await readLibrary(libraryPaths(config.libraryDir));

      console.log(`backdrops (${contents.environment.length}):`);
      for (const filename of contents.environment) console.log(`  ${filename}`);

      if (!contents.ready) {
        console.log('\nNot ready: the library needs at least one backdrop.');
        process.exitCode = 1;
      } else if (contents.counts.environment < COMFORTABLE_ENVIRONMENTS) {
        console.log(
          `\nOnly ${contents.counts.environment} backdrop(s). A 5-10 minute episode looks better ` +
            `with ${COMFORTABLE_ENVIRONMENTS} or more.`,
        );
      }
    });

  library
    .command('remove-environment')
    .argument('<filename>', 'backdrop filename, as shown by "library list"')
    .description('Delete one backdrop')
    .action(async (filename: string) => {
      const config = loadModuleConfig();
      const logger = createLogger({ level: config.logLevel });

      await run(async () => {
        const contents = await removeFromLibrary(libraryPaths(config.libraryDir), filename);
        logger.done(`Removed ${filename}; ${contents.counts.environment} backdrop(s) left`);
      }, logger);
    });
}
