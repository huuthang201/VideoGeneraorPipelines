import path from 'node:path';
import {
  StoryboardDraftSchema,
  checkStoryboardStructure,
  narrationFromScenes,
  type Storyboard,
  type StoryboardDraft,
} from '../domain/storyboard';
import type { ProductInfo } from '../domain/project';
import type { Brief } from '../domain/brief';
import type { AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import { exec } from '../utils/exec';
import { checkFacts } from './fact-guard';
import { buildRetryPrompt, buildStoryboardPrompt } from './prompts/generate-storyboard';
import { VIETNAMESE_VOICES } from '../tts/types';
import { withRetry } from '../utils/retry';

/**
 * Storyboard generation through the Claude Code CLI (spec §50).
 *
 * The model is given the Read tool and pointed at the preview directory, which
 * is how it gets to actually look at the photos - the whole reason this stage
 * is worth an AI call at all (spec §6). Everything it returns is then run
 * through three gates before the pipeline will touch it:
 *
 *   1. schema  - shape and whitelisted enum values
 *   2. structure - hook first, cta last, assets that really exist
 *   3. facts   - no prices or claims absent from info.json
 *
 * A failure at any gate is fed back verbatim and retried, up to the limit in
 * spec §55. Echoing the specific violation works far better than asking the
 * model to try again, and it keeps the budget at one call for the common case.
 */

export interface GenerateInput {
  projectId: string;
  previewDir: string;
  info: ProductInfo | null;
  assetFilenames: string[];
  brief?: Brief | null;
}

/**
 * Spec §55 budgets Claude two attempts. That ceiling matters more than it
 * looks: a single `claude -p` call reading three images can take minutes, so an
 * extra retry is not a cheap safety net but several more minutes before the job
 * fails. Two is enough for the common case, where the first reply is either
 * right or wrong in a way the echoed violation fixes.
 */
const MAX_ATTEMPTS = 2;

/**
 * Bounded so a stalled call fails the job rather than hanging the queue.
 * Typical calls complete in 40-60s; the ceiling is set well above that because
 * the tail is long and a timeout costs the whole job.
 */
const CLAUDE_TIMEOUT_MS = 360_000;

/**
 * Transport failures are retried separately from content failures.
 *
 * They are different problems and deserve different handling: a timeout or a
 * dropped connection says nothing about the reply and is worth simply trying
 * again, whereas a schema violation needs the specific error echoed back or the
 * model will just repeat it. Collapsing the two meant a transient stall killed
 * the job outright while a fixable content error got two chances.
 */
const TRANSPORT_ATTEMPTS = 2;

export class ClaudeCodeStoryboardProvider {
  readonly name = 'claude-code';

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async generate(input: GenerateInput): Promise<Storyboard> {
    const basePrompt = buildStoryboardPrompt({
      projectId: input.projectId,
      productName: input.info?.name ?? input.projectId,
      info: input.info,
      assetFilenames: input.assetFilenames,
      previewDir: path.resolve(input.previewDir),
      targetDurationSec: this.config.video.targetDuration,
      defaultStyle: this.config.video.style,
      femaleVoice: VIETNAMESE_VOICES.female,
      maleVoice: VIETNAMESE_VOICES.male,
      brief: input.brief,
      allowBroll: this.config.image.engine !== 'none',
      // Derived from the ceiling the pipeline enforces, so the model is told
      // the limit up front rather than discovering it via a rejected job.
      maxBrollScenes: Math.max(1, Math.floor(6 * this.config.image.maxBrollRatio)),
    });

    let prompt = basePrompt;
    let lastProblem = 'unknown';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) this.logger.warn(`Retrying Claude (attempt ${attempt}/${MAX_ATTEMPTS})`);

      const raw = await this.callClaude(prompt, input.previewDir);
      const json = extractJson(raw);

      if (!json) {
        lastProblem = 'The response did not contain a JSON object.';
        prompt = buildRetryPrompt(basePrompt, lastProblem);
        continue;
      }

      const parsed = StoryboardDraftSchema.safeParse(json);
      if (!parsed.success) {
        lastProblem = parsed.error.issues
          .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n');
        // The specific issues, not just "validation failed" - without them
        // there is no way to tell whether the model got the shape wrong or the
        // schema is too strict.
        this.logger.warn(`Storyboard failed schema validation:\n${lastProblem}`);
        prompt = buildRetryPrompt(basePrompt, `Lỗi schema:\n${lastProblem}`);
        continue;
      }

      const structural = checkStoryboardStructure(parsed.data, input.assetFilenames);
      if (structural.length > 0) {
        lastProblem = structural.map((p) => `- ${p}`).join('\n');
        this.logger.warn(`Storyboard failed structural checks:\n${lastProblem}`);
        prompt = buildRetryPrompt(basePrompt, `Lỗi cấu trúc:\n${lastProblem}`);
        continue;
      }

      const facts = checkFacts(parsed.data, input.info);
      if (!facts.ok) {
        lastProblem = facts.feedback;
        this.logger.warn(
          `Fact guard rejected ${facts.violations.length} unsourced claim(s): ` +
            facts.violations.map((v) => `"${v.matched}"`).join(', '),
        );
        prompt = buildRetryPrompt(basePrompt, facts.feedback);
        continue;
      }

      return this.toStoryboard(parsed.data);
    }

    throw new PipelineError(
      ERROR_CODES.AI_FACT_VIOLATION,
      'generate-storyboard',
      `Claude did not produce an acceptable storyboard in ${MAX_ATTEMPTS} attempts. Last problem:\n${lastProblem}`,
    );
  }

  private async callClaude(prompt: string, previewDir: string): Promise<string> {
    return withRetry(() => this.invokeClaudeOnce(prompt, previewDir), {
      attempts: TRANSPORT_ATTEMPTS,
      initialDelayMs: 2000,
      // Only worth retrying when the problem was reaching the model at all.
      // An exit code carrying a real refusal will repeat, so retrying it just
      // spends minutes to fail the same way.
      shouldRetry: (err) => err instanceof PipelineError && err.code === ERROR_CODES.AI_CALL_FAILED,
      onRetry: (err, attempt, delayMs) =>
        this.logger.warn(
          `Claude call failed (${err instanceof Error ? err.message : String(err)}); ` +
            `transport retry ${attempt}/${TRANSPORT_ATTEMPTS - 1} in ${delayMs}ms`,
        ),
    });
  }

  private async invokeClaudeOnce(prompt: string, previewDir: string): Promise<string> {
    const result = await exec(
      this.config.ai.claudeBin,
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--model',
        this.config.ai.model,
        // Read only: the model looks at photographs and returns text. It has no
        // reason to write files or run commands, and not granting those tools
        // means a prompt-injected instruction inside an image filename has
        // nothing to act with.
        '--allowedTools',
        'Read',
        '--add-dir',
        path.resolve(previewDir),
      ],
      { timeoutMs: CLAUDE_TIMEOUT_MS },
    ).catch((err) => {
      throw new PipelineError(
        ERROR_CODES.AI_CALL_FAILED,
        'generate-storyboard',
        `Could not run "${this.config.ai.claudeBin}": ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { cause: err },
      );
    });

    if (result.code !== 0) {
      throw new PipelineError(
        ERROR_CODES.AI_CALL_FAILED,
        'generate-storyboard',
        `Claude exited ${result.code}: ${result.stderr.trim() || result.stdout.slice(0, 400)}`,
      );
    }

    // --output-format json wraps the reply in an envelope; the storyboard is
    // inside .result as a string.
    try {
      const envelope = JSON.parse(result.stdout) as { result?: unknown; is_error?: boolean };
      if (typeof envelope.result === 'string') return envelope.result;
    } catch {
      // Fall through - a plain-text reply is still worth trying to parse.
    }
    return result.stdout;
  }

  /** Fills in everything the model was deliberately not asked for (plan §2.4). */
  private toStoryboard(draft: StoryboardDraft): Storyboard {
    return {
      version: '1.0',
      project: draft.project,
      video: {
        width: this.config.video.width,
        height: this.config.video.height,
        fps: this.config.video.fps,
        targetDuration: this.config.video.targetDuration,
        durationMin: this.config.video.durationMin,
        durationMax: this.config.video.durationMax,
        style: draft.video.style,
      },
      voice: {
        language: 'vi-VN',
        provider: this.config.tts.engine,
        voice: draft.voice.voice,
        rate: draft.voice.rate ?? this.config.tts.rate,
        pitch: this.config.tts.pitch,
      },
      content: {
        hook: draft.content.hook,
        narration: narrationFromScenes(draft),
        cta: draft.content.cta,
      },
      scenes: draft.scenes,
    };
  }
}

/**
 * Pulls the JSON object out of a reply.
 *
 * Models wrap JSON in prose or fences often enough that demanding a bare object
 * would burn retries on a formatting habit rather than on anything substantive.
 * Brace matching is used rather than a regex so a nested object cannot end the
 * match early.
 */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/u);
  const candidate = fenced?.[1] ?? text;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
