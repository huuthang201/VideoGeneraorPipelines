import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import {
  api,
  isPodcast,
  type Brief,
  type BriefData,
  type CheckData,
  type ImagesData,
  type LogLine,
  type RenderData,
  type RunStep,
  type StepDetail,
  type StepId,
  type StoryboardData,
  type UploadData,
  type VoiceData,
} from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** What `BriefBody` may change. A subset of Brief - it never touches images. */
type BriefPatch = Pick<Brief, 'context' | 'hook' | 'targetMinutes' | 'targetSeconds'>;

/**
 * What sits under the pipeline row when a box is opened.
 *
 * A panel rather than a dialog, and deliberately: the project screen is already
 * a dialog, and a second one on top of it hides the row of boxes - which is the
 * one thing you want to keep seeing while a run is moving. Opening a step here
 * keeps the pipeline in view and shows the step's work beneath it.
 *
 * Two halves, always in the same order: what the step *produced*, then what it
 * *printed*. The artefact is what someone came to look at; the log is what they
 * fall back to when the artefact is missing or wrong.
 */

/** So the log panel can fetch the whole run without threading the id through. */
const LogProjectContext = createContext<string>('');

const TITLES: Record<StepId, string> = {
  brief: 'Ý tưởng',
  storyboard: 'Kịch bản',
  images: 'Ảnh nền',
  voice: 'Giọng đọc',
  render: 'Dựng video',
  check: 'Kiểm tra',
  upload: 'Đăng YouTube',
};

export function formatDuration(ms: number | null): string | null {
  if (ms === null || ms < 0) return null;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

const clock = (seconds: number | null | undefined): string =>
  seconds === null || seconds === undefined
    ? '—'
    : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm italic">{children}</p>;
}

// ------------------------------------------------------------ per step ----

/**
 * The brief, and the only step body that is a form rather than a report.
 *
 * It reads oddly next to the others until you notice that this *is* the step:
 * "Ý tưởng" produces a context and a hook, and whether those came from Claude
 * or from someone typing them makes no difference to what the step is. Editing
 * them used to live in a separate panel further down the project screen, which
 * meant the same two sentences appeared twice - once to write and once to read.
 *
 * Blur rather than a save button, matching the rest of the app: there is
 * nothing to submit, and a field you have finished with is a field you have
 * changed.
 */
function BriefBody({
  data,
  editable,
  disabled,
  defaultTargetSeconds,
  onSave,
}: {
  data: BriefData | null;
  editable: boolean;
  disabled: boolean;
  defaultTargetSeconds: number | null;
  onSave: (patch: Partial<BriefPatch>) => void;
}) {
  if (!editable) {
    if (!data?.context && !data?.hook) {
      return <Empty>Chưa có nội dung. Bấm Bắt đầu để Claude tự nghĩ.</Empty>;
    }
    return (
      <div className="flex flex-col gap-3">
        {data.context && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs font-medium">Chủ đề</p>
            <p className="text-sm whitespace-pre-wrap">{data.context}</p>
          </div>
        )}
        {data.hook && (
          <div>
            <p className="text-muted-foreground mb-1 text-xs font-medium">Câu mở đầu</p>
            <p className="text-sm whitespace-pre-wrap">{data.hook}</p>
          </div>
        )}
      </div>
    );
  }

  const podcast = isPodcast();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {podcast
          ? 'Để trống thì khi bấm Bắt đầu, Claude sẽ tự nhìn thư viện ảnh và nghĩ chủ đề.'
          : 'Để trống thì khi bấm Bắt đầu, Claude sẽ tự nghĩ một sự thật theo tên dự án.'}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="step-context">
          {podcast ? 'Chủ đề (lời đọc bằng tiếng Anh)' : 'Sự thật muốn kể (giọng nam miền Bắc)'}
        </Label>
        <Textarea
          id="step-context"
          rows={4}
          defaultValue={data?.context ?? ''}
          disabled={disabled}
          onBlur={(e) => onSave({ context: e.target.value })}
          placeholder={
            podcast
              ? "VD: A slow walk through Hanoi's Old Quarter before sunrise"
              : 'VD: Mật ong không bao giờ hỏng, vì gần như không có nước nên vi khuẩn không sống được'
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="step-hook">
          {podcast ? 'Câu mở đầu' : 'Câu mở đầu — hai giây quyết định người xem ở lại'}
        </Label>
        <Textarea
          id="step-hook"
          rows={2}
          defaultValue={data?.hook ?? ''}
          disabled={disabled}
          onBlur={(e) => onSave({ hook: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="step-length">
          {podcast ? 'Độ dài mong muốn (phút)' : 'Độ dài mong muốn (giây)'}
        </Label>
        <Input
          id="step-length"
          type="number"
          className="w-40"
          disabled={disabled}
          min={podcast ? 1 : 15}
          max={podcast ? 20 : 90}
          step={podcast ? 1 : 5}
          defaultValue={
            podcast
              ? (data?.targetMinutes ?? '')
              : (data?.targetSeconds ?? defaultTargetSeconds ?? '')
          }
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n <= 0) return;
            onSave(podcast ? { targetMinutes: n } : { targetSeconds: n });
          }}
        />
      </div>
    </div>
  );
}

function StoryboardBody({ data }: { data: StoryboardData | null }) {
  if (!data?.scenes) return <Empty>Chưa có kịch bản.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ['Tiêu đề', data.episodeTitle],
          ['Tóm tắt', data.summary],
          ['Số cảnh', `${data.scenes.length}`],
          ['Số từ', `${data.wordCount}`],
          ...(data.imageQueries
            ? ([['Truy vấn ảnh', data.imageQueries.join(' · ')]] as [string, React.ReactNode][])
            : []),
        ]}
      />
      <ol className="max-h-72 overflow-y-auto rounded-md border">
        {data.scenes.map((scene, i) => (
          <li key={scene.id} className="flex gap-2 border-b p-2 text-xs last:border-b-0">
            <span className="text-muted-foreground w-5 shrink-0 tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="uppercase">
                  {scene.type}
                </Badge>
                {scene.title && <span className="font-medium">{scene.title}</span>}
                {scene.imageQuery && (
                  <span className="text-muted-foreground">🔍 {scene.imageQuery}</span>
                )}
                {scene.environment && (
                  <span className="text-muted-foreground">🖼 {scene.environment}</span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{scene.narration}</p>
              {scene.narrationVi && (
                <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">
                  {scene.narrationVi}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ImagesBody({ data }: { data: ImagesData | null }) {
  if (!data?.scenes?.length) return <Empty>Chưa có ảnh nào được gán cho cảnh.</Empty>;
  return (
    <div className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 overflow-y-auto">
      {data.scenes.map((scene) => (
        <figure key={scene.sceneId} className="flex flex-col gap-1">
          <img
            src={scene.url}
            alt={scene.filename}
            loading="lazy"
            className="bg-muted aspect-video w-full rounded border object-cover"
          />
          <figcaption className="text-muted-foreground text-[11px] leading-tight">
            <span className="text-foreground font-medium">{scene.sceneId}</span> ·{' '}
            {scene.seconds?.toFixed(1) ?? '—'}s · {scene.width}×{scene.height} · {scene.fit}
            {scene.credit && (
              <>
                <br />
                <a
                  href={scene.credit.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {scene.credit.label}
                </a>
              </>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function VoiceBody({ data }: { data: VoiceData | null }) {
  if (!data?.audioUrl) return <Empty>Chưa có giọng đọc.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ['Giọng', data.voice ?? '—'],
          ['Thời lượng', clock(data.seconds)],
          ['Mốc từ', `${data.wordTimings}`],
          ...(data.devMock
            ? ([['Lưu ý', <Badge variant="warning">Audio giả (--mock-tts), không được đăng</Badge>]] as [
                string,
                React.ReactNode,
              ][])
            : []),
        ]}
      />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls preload="none" src={data.audioUrl} className="w-full" />
      {data.narration && (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">Lời đọc đầy đủ</summary>
          <p className="mt-2 max-h-48 overflow-y-auto text-xs whitespace-pre-wrap">
            {data.narration}
          </p>
        </details>
      )}
      {data.captionsHead && (
        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">Phụ đề (40 dòng đầu)</summary>
          <pre className="mt-2 max-h-48 overflow-auto text-[11px] leading-snug">
            {data.captionsHead}
          </pre>
        </details>
      )}
    </div>
  );
}

function RenderBody({ data }: { data: RenderData | null }) {
  if (!data?.videoUrl) return <Empty>Chưa dựng.</Empty>;

  /*
   * Rendering, not "a progress file exists".
   *
   * This read `!data.progress?.totalFrames`, which meant a finished render was
   * treated as still going for as long as its progress.json sat on disk - and
   * that file is never cleaned up, so the player simply never appeared for any
   * completed video. Comparing the two counts asks the question that was meant:
   * are there frames still to draw.
   */
  const rendering = data.progress
    ? data.progress.renderedFrames < data.progress.totalFrames
    : false;
  const done = !rendering;
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ['Khung hình', data.width && data.height ? `${data.width}×${data.height} @ ${data.fps}fps` : '—'],
          ['Số cảnh', data.scenes !== null ? `${data.scenes}` : '—'],
          ['Thời lượng', clock(data.seconds)],
          ['Tổng khung', data.frames !== null ? data.frames.toLocaleString('vi-VN') : '—'],
          ...(data.renderSeconds
            ? ([['Chạy hết', `${data.renderSeconds.toFixed(1)}s`]] as [string, React.ReactNode][])
            : []),
        ]}
      />
      {done && (
        <video
          controls
          preload="metadata"
          src={data.videoUrl}
          className={cn(
            'w-full rounded-md border bg-black',
            data.width && data.height && data.height > data.width ? 'mx-auto max-w-[14rem]' : '',
          )}
        />
      )}
    </div>
  );
}

function CheckBody({ data }: { data: CheckData | null }) {
  if (!data?.thumbnails) return <Empty>Chưa kiểm tra.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          ['Trạng thái job', data.status ?? '—'],
          [
            'Mong đợi',
            data.expected
              ? `${data.expected.width}×${data.expected.height} · ${clock(data.expected.seconds)}`
              : '—',
          ],
        ]}
      />
      {data.error && (
        <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-2 text-sm">
          <strong>{data.error.code}</strong> ở <code>{data.error.stage}</code>: {data.error.message}
        </p>
      )}
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium">
          Ảnh bìa — ba khung, vì khung mở đầu là lựa chọn hiển nhiên và thường không phải khung đẹp nhất
        </p>
        <div className="flex gap-2">
          {data.thumbnails.map((t) => (
            <img
              key={t.name}
              src={t.url}
              alt={t.name}
              loading="lazy"
              className="bg-muted h-20 rounded border object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadBody({ data }: { data: UploadData | null }) {
  if (!data || typeof data.configured !== 'boolean') return <Empty>Chưa có gì.</Empty>;
  if (!data.configured) {
    return <Empty>Chưa cấu hình YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.</Empty>;
  }
  return (
    <div className="flex flex-col gap-3">
      <Facts
        rows={[
          [
            'Chế độ',
            data.autoPublish === 'none'
              ? 'Không đăng'
              : data.autoPublish === 'now'
                ? 'Đăng luôn'
                : 'Lên lịch',
          ],
          ...(data.upload
            ? ([
                [
                  'Đã đăng',
                  <a
                    href={data.upload.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    {data.upload.url}
                    <ExternalLinkIcon className="size-3" />
                  </a>,
                ],
                ['Quyền riêng tư', data.upload.privacyStatus],
                ...(data.upload.publishAt
                  ? ([['Hẹn công khai', new Date(data.upload.publishAt).toLocaleString('vi-VN')]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
                ...(data.upload.channel
                  ? ([['Kênh', data.upload.channel.title]] as [string, React.ReactNode][])
                  : []),
              ] as [string, React.ReactNode][])
            : []),
        ]}
      />
      {data.upload?.thumbnailError && (
        <p className="border-warning/40 bg-warning/10 rounded-md border p-2 text-xs">
          Ảnh bìa chưa đặt được: {data.upload.thumbnailError}
        </p>
      )}
      {data.kit && (
        <details className="rounded-md border p-2" open={!data.upload}>
          <summary className="cursor-pointer text-xs font-medium">Nội dung sẽ đăng</summary>
          <div className="mt-2 flex flex-col gap-2 text-xs">
            <p className="font-medium">{data.kit.title}</p>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap">{data.kit.description}</p>
            {data.kit.chapters && data.kit.chapters.length > 0 && (
              <p className="text-muted-foreground">{data.kit.chapters.length} mốc chương</p>
            )}
            <p className="text-muted-foreground">Tags: {data.kit.tags.join(', ')}</p>
          </div>
        </details>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- log ----

const LEVEL_STYLE: Record<LogLine['level'], string> = {
  info: 'text-muted-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
};

function LogBody({
  log,
  live,
  stepId,
}: {
  log: LogLine[];
  live: boolean;
  stepId: StepId;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<'step' | 'all'>('step');
  const [all, setAll] = useState<LogLine[] | null>(null);
  const projectId = useContext(LogProjectContext);

  useEffect(() => {
    if (scope !== 'all') return;
    let cancelled = false;
    const load = () =>
      void api<LogLine[]>(`/projects/${projectId}/pipeline/log`)
        .then((lines) => !cancelled && setAll(lines))
        .catch(() => undefined);
    load();
    if (!live) return () => { cancelled = true; };
    const timer = setInterval(load, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [scope, projectId, live]);

  const lines = scope === 'step' ? log : (all ?? []);

  // Follows the tail while the step is running, and stops the moment it is not
  // - so opening a finished step does not yank you to the bottom of it.
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length, live]);

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        Which lines to show.
        
        A line is filed under whichever step was running when it arrived, and
        that is sampled twice a second rather than announced - so a stage that
        finishes in a blink can have its output land under its neighbour. "Toàn
        bộ" exists so nothing is ever actually hidden by that.
      */}
      <div className="flex gap-1">
        {(['step', 'all'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={scope === value ? 'secondary' : 'ghost'}
            className="h-6 px-2 text-[11px]"
            onClick={() => setScope(value)}
          >
            {value === 'step' ? 'Bước này' : 'Toàn bộ lần chạy'}
          </Button>
        ))}
      </div>

      {lines.length === 0 ? (
        <Empty>Chưa có log trong lần chạy hiện tại.</Empty>
      ) : (
        <div className="bg-muted/50 max-h-56 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed">
          {lines.map((line, i) => (
            <div key={`${line.at}-${i}`} className={cn('flex gap-2', LEVEL_STYLE[line.level])}>
              <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                {new Date(line.at).toLocaleTimeString('vi-VN', { hour12: false })}
              </span>
              {scope === 'all' && (
                <span
                  className={cn(
                    'shrink-0 opacity-60',
                    line.step === stepId && 'text-primary font-medium opacity-100',
                  )}
                >
                  {line.step ?? '—'}
                </span>
              )}
              <span className="min-w-0 break-all whitespace-pre-wrap">{line.text}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- panel ----

/**
 * One step, in a dialog of its own.
 *
 * It used to open inline, underneath the row of boxes, which put it above a
 * project screen that also carried the brief, the script and the finished
 * video as permanent sections. The result was a page where the same script
 * appeared twice and you scrolled past four things to reach the one you
 * clicked. Every one of those sections is a step's output, so each now lives in
 * the step it belongs to and appears when that step is opened.
 *
 * A dialog on top of a dialog, which Radix handles: Escape and the overlay
 * close the top one only, so dismissing a step returns you to the project
 * rather than out of it entirely.
 */
export function StepPanel({
  projectId,
  step,
  editable,
  disabled,
  defaultTargetSeconds,
  onSaveBrief,
  onClose,
}: {
  projectId: string;
  step: RunStep;
  /** Whether the brief step offers its form. False while a run is going. */
  editable: boolean;
  disabled: boolean;
  defaultTargetSeconds: number | null;
  onSaveBrief: (patch: Partial<BriefPatch>) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StepDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = step.status === 'running';

  useEffect(() => {
    let cancelled = false;

    /*
     * Drop the previous step's payload before fetching this one.
     *
     * Without this, switching steps renders the new step's body against the old
     * step's data for one frame - `StoryboardBody` reading a brief, say - and
     * `data.scenes.length` takes the whole screen down. The parent also
     * remounts this component per step, which makes the reset belt and braces;
     * both are cheap and the failure mode is a blank app.
     */
    setDetail(null);
    setError(null);

    const load = async () => {
      try {
        const next = await api<StepDetail>(`/projects/${projectId}/pipeline/steps/${step.id}`);
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    void load();
    // Only a running step is worth re-reading: everything else is a file on
    // disk that is not going to change while you look at it.
    if (!running) return () => { cancelled = true; };
    const timer = setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, step.id, running]);

  const data = detail?.data ?? null;

  return (
    <LogProjectContext.Provider value={projectId}>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto sm:max-w-2xl">
      <DialogHeader className="flex-row items-center gap-2 space-y-0 pr-6">
        <DialogTitle className="text-base">{TITLES[step.id]}</DialogTitle>
        {running && <Loader2Icon className="text-primary size-3.5 animate-spin" />}
        {step.durationMs !== null && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {step.status === 'skipped' && <Badge variant="secondary">Bỏ qua</Badge>}
        {step.status === 'failed' && <Badge variant="destructive">Lỗi</Badge>}
      </DialogHeader>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !detail ? (
        <p className="text-muted-foreground text-sm">Đang tải…</p>
      ) : (
        <>
          {step.id === 'brief' && (
            <BriefBody
              data={data as BriefData | null}
              editable={editable}
              disabled={disabled}
              defaultTargetSeconds={defaultTargetSeconds}
              onSave={onSaveBrief}
            />
          )}
          {step.id === 'storyboard' && <StoryboardBody data={data as StoryboardData | null} />}
          {step.id === 'images' && <ImagesBody data={data as ImagesData | null} />}
          {step.id === 'voice' && <VoiceBody data={data as VoiceData | null} />}
          {step.id === 'render' && <RenderBody data={data as RenderData | null} />}
          {step.id === 'check' && <CheckBody data={data as CheckData | null} />}
          {step.id === 'upload' && <UploadBody data={data as UploadData | null} />}

          <Separator />
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-xs font-medium">Log của bước này</p>
            <LogBody log={detail.log} live={running} stepId={step.id} />
          </div>
        </>
      )}
      </DialogContent>
    </Dialog>
    </LogProjectContext.Provider>
  );
}
