import path from 'node:path';
import { access, mkdir } from 'node:fs/promises';
import type { ImageGenerationProvider } from './provider';
import { checkImagePrompt } from './prompt-guard';
import type { ProductInfo } from '../../domain/project';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { exec } from '../../utils/exec';

/**
 * B-roll generation through a local ComfyUI running FLUX.1-schnell.
 *
 * The HTTP work lives in scripts/generate_image.py rather than being repeated
 * here, for the same reason the Edge TTS provider shells out: the script is
 * also the entry point the /generate-image skill calls directly, and two
 * implementations of the same workflow graph would drift apart. It uses only
 * the standard library, so the system Python is enough - no virtualenv.
 *
 * FLUX.1-schnell specifically, and not FLUX.1-dev. schnell is Apache 2.0;
 * dev carries a non-commercial licence, and this pipeline exists to make
 * advertising for people selling things. schnell is also a four-step model
 * against dev's twenty-plus, which matters when each image already costs the
 * best part of a minute.
 */

export interface ComfyUIOptions {
  pythonBin: string;
  serverUrl: string;
  /** Product data, so the guard knows what the images must not depict. */
  info: ProductInfo | null;
  timeoutMs?: number;
  onLog?: (message: string) => void;
}

/** FLUX wants multiples of 16; 768x1344 is the 9:16 size it handles best. */
export const BROLL_SIZE = { width: 768, height: 1344 } as const;

const DEFAULT_TIMEOUT_MS = 600_000;

export class ComfyUIImageProvider implements ImageGenerationProvider {
  readonly name = 'comfyui-flux-schnell';

  constructor(private readonly options: ComfyUIOptions) {}

  async generateBackground(input: {
    prompt: string;
    width: number;
    height: number;
    outPath: string;
  }): Promise<string> {
    // The guard runs before anything is spent. A prompt that would put the
    // product in the frame, or depict a capability nobody claimed, is rejected
    // rather than generated and quietly used - see prompt-guard.ts.
    const guard = checkImagePrompt(input.prompt, this.options.info);
    if (!guard.ok) {
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROMPT_REJECTED,
        'generate-broll',
        `Image prompt rejected:\n${guard.feedback}`,
        { prompt: input.prompt, violations: guard.violations },
      );
    }

    await mkdir(path.dirname(input.outPath), { recursive: true });

    const script = path.join(process.cwd(), 'scripts', 'generate_image.py');
    const args = [
      script,
      `--prompt=${input.prompt}`,
      `--width=${input.width}`,
      `--height=${input.height}`,
      `--output=${input.outPath}`,
      `--server=${this.options.serverUrl}`,
    ];

    const result = await exec(this.options.pythonBin, args, {
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }).catch((err) => {
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'generate-broll',
        `Could not run ${this.options.pythonBin}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err },
      );
    });

    for (const line of result.stdout.split('\n')) {
      if (line.trim()) this.options.onLog?.(line.trim());
    }

    if (result.code !== 0) {
      // Exit code 3 means the server was unreachable, which is worth saying
      // plainly: it is the difference between "start ComfyUI" and "your prompt
      // was wrong", and the two get confused constantly.
      const unreachable = result.code === 3;
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'generate-broll',
        unreachable
          ? `ComfyUI is not running at ${this.options.serverUrl}.\n` +
            `Start it with:  cd ~/ComfyUI && ./venv/bin/python3 main.py\n` +
            `Or run the pipeline with --no-broll to build from the real photos only.`
          : `Image generation failed (exit ${result.code}): ${result.stderr.trim().slice(0, 600)}`,
        { exitCode: result.code, prompt: input.prompt },
      );
    }

    const written = await access(input.outPath).then(
      () => true,
      () => false,
    );
    if (!written) {
      throw new PipelineError(
        ERROR_CODES.IMAGE_PROCESSING_FAILED,
        'generate-broll',
        `generate_image.py reported success but wrote nothing to ${input.outPath}`,
      );
    }

    return input.outPath;
  }

  /** True when ComfyUI is up. Lets the pipeline skip b-roll instead of failing. */
  async isAvailable(): Promise<boolean> {
    const result = await exec('curl', [
      '-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}',
      `${this.options.serverUrl}/system_stats`,
    ]).catch(() => null);

    return result?.stdout.trim() === '200';
  }
}
