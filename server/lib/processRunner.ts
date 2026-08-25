import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ModuleId } from '../../src/domain/config';

/**
 * Every "heavy" action the UI can trigger (prepare, suggest-brief,
 * generate-storyboard, generate) runs through the same CLI surface everyone
 * else uses (spec: single entry point). The server never imports the AI/TTS/
 * render code directly - it only spawns `tsx src/cli/index.ts <command>` and
 * reads back whatever the command wrote to disk.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'cli', 'index.ts');

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Every spawn names its module.
 *
 * The CLI refuses to guess one, on purpose - the two pipelines have separate
 * job directories and separate YouTube credentials - so the flag is prepended
 * here rather than left to each caller to remember.
 */
export function runCli(module: ModuleId, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [CLI_ENTRY, '--module', module, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
  });
}

export function spawnCli(module: ModuleId, args: string[]): ReturnType<typeof spawn> {
  return spawn(TSX_BIN, [CLI_ENTRY, '--module', module, ...args], { cwd: REPO_ROOT });
}
