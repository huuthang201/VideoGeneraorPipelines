import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClockIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import {
  api,
  apiJson,
  isPodcast,
  type Brief,
  type ProjectDetail,
  type RunState,
  type StepId,
} from '@/lib/api';
import { ActionMark, Button, useActionPhase } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PipelineFlow } from '@/components/pipeline/PipelineFlow';
import { StepPanel } from '@/components/pipeline/StepPanel';
import { ScenePicker } from '@/components/ScenePicker';
import { useToast } from '@/components/Toaster';
import { cn } from '@/lib/utils';

/**
 * One project, with the pipeline across the top.
 *
 * The order is deliberate: the boxes come first, then the one button that runs
 * them, then the settings that shape a run, then the output. That is the order
 * someone actually uses it in - watch, run, adjust, collect - and it puts the
 * thing that changes every second where the eye already is.
 */
export function ProjectDialog({
  projectId,
  run,
  onClose,
  onChanged,
}: {
  projectId: string;
  run: RunState | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [openStep, setOpenStep] = useState<StepId | null>(null);

  /*
   * The dropdown saves the moment it changes, and used to do so with no sign
   * at all - the only way to know it had worked was to close the project and
   * open it again. It is not a button, so it borrows the button's own cycle.
   */
  const publish = useActionPhase();

  /**
   * Puts a finished video on the channel, now or in the queue.
   *
   * Separate from the auto-publish setting beside Start, and it has to be: that
   * one says what a *future* run should do, and it is no help at all for the
   * video sitting on disk right now with "Không đăng" saved against it. Before
   * this the only way to publish such a video was the command line.
   */
  const upload = async (schedule: boolean) => {
    try {
      const res = await apiJson<{ position: number }>(
        `/projects/${projectId}/pipeline/youtube`,
        'POST',
        schedule ? { schedule: true } : {},
      );
      toast(
        'info',
        res.position > 0
          ? `Đã xếp hàng — còn ${res.position} video đang tải trước`
          : schedule
            ? 'Đang tải lên và hẹn giờ đăng…'
            : 'Đang tải lên YouTube…',
      );
      onChanged();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const load = useCallback(async () => {
    try {
      setDetail(await api<ProjectDetail>(`/projects/${projectId}`));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  }, [projectId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // A finished step usually changed something on disk - a new script, a new
  // video - so the panels below the boxes are refetched when the run moves on.
  const activeStepId = run?.steps.find((s) => s.status === 'running')?.id ?? null;
  useEffect(() => {
    void load();
  }, [activeStepId, run?.status, load]);

  const running = run?.status === 'running';

  const start = async () => {
    try {
      await apiJson(`/projects/${projectId}/pipeline/start`, 'POST', {});
      toast('info', 'Đã bắt đầu chạy toàn bộ pipeline');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const saveBrief = async (patch: Partial<Brief>) => {
    if (!detail) return;
    const brief: Brief = { ...(detail.brief ?? {}), ...patch };
    // Empty strings are "not set", not "set to nothing" - the schemas reject a
    // present-but-empty context, and sending one would fail every save.
    const body: Brief = {};
    if (brief.context?.trim()) body.context = brief.context.trim();
    if (brief.hook?.trim()) body.hook = brief.hook.trim();
    if (isPodcast()) {
      if (brief.targetMinutes) body.targetMinutes = brief.targetMinutes;
      if (brief.environments?.length) body.environments = brief.environments;
    } else if (brief.targetSeconds) {
      body.targetSeconds = brief.targetSeconds;
    }

    try {
      await apiJson(`/projects/${projectId}/brief`, 'PUT', body);
      await load();
      onChanged();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  /*
   * The question is asked by the caller, not here. An `async` function returns
   * a promise even when it turns straight round at a cancelled confirm, and
   * the button would take that resolved promise as work done and flash a tick
   * at someone who had just said no.
   */
  const remove = async () => {
    try {
      await apiJson(`/projects/${projectId}`, 'DELETE');
      toast('success', 'Đã xoá dự án');
      onChanged();
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.displayName ?? projectId}</DialogTitle>
        </DialogHeader>

        {/* ---- The pipeline ------------------------------------------- */}
        <section className="flex flex-col gap-3">
          {run ? (
            <PipelineFlow
              run={run}
              selected={openStep}
              onSelect={(id) => setOpenStep((current) => (current === id ? null : id))}
            />
          ) : (
            <div className="text-muted-foreground text-sm">Đang tải tiến trình…</div>
          )}

          {/*
            The opened step, under the row it belongs to.
            
            `run.steps.find` rather than the id alone, so the panel keeps
            redrawing from the live run - a step opened while it is working
            updates its status, its clock and its log without being reopened.
          */}
          {openStep &&
            run &&
            (() => {
              const step = run.steps.find((s) => s.id === openStep);
              return step ? (
                <StepPanel
                  // Remount per step, so no state from the previous one leaks
                  // into a body that expects a different shape.
                  key={step.id}
                  projectId={projectId}
                  step={step}
                  // The brief step is where the brief is written now, so it
                  // needs to know whether writing is allowed and what an empty
                  // length box should show.
                  editable={step.id === 'brief'}
                  disabled={running}
                  defaultTargetSeconds={detail?.defaultTargetSeconds ?? null}
                  onSaveBrief={(patch) => void saveBrief(patch)}
                  onClose={() => setOpenStep(null)}
                />
              ) : null;
            })()}

          {run?.status === 'failed' && run.error && !openStep && (
            <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
              {run.error}
            </p>
          )}

          {/*
            Start, and the one setting that changes what Start does.
            
            The publish choice sits here rather than with the brief because it
            is not a property of the video - it is a property of pressing the
            button, and the sentence beside it changes to match.
          */}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={start} disabled={running} size="lg">
              {/* This spinner is the *run*, not the click. The click is over in
                  a few hundred milliseconds and the button shows that itself;
                  what keeps turning afterwards is the pipeline. */}
              {running ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              {running ? 'Đang chạy…' : run?.status === 'done' ? 'Chạy lại từ đầu' : 'Bắt đầu'}
            </Button>

            {/*
              Watching the finished video is the commonest thing anyone does
              here, and after the content sections moved into the steps it was
              the one action you had to *guess* at - the player lives in the
              render step, which is not where you would look for it. This opens
              exactly that step rather than adding a second player: one video
              element, one place it is defined.
            */}
            {detail?.hasVideo && (
              <Button variant="secondary" size="lg" onClick={() => setOpenStep('render')}>
                <PlayIcon />
                Xem video
              </Button>
            )}

            {/* Only for a video that exists and is not already up. Once it is,
                the footer carries the link to it instead. */}
            {detail?.hasVideo && !detail.upload?.url && (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={running}
                  onClick={() => upload(true)}
                >
                  <CalendarClockIcon />
                  Lên lịch đăng
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={running}
                  onClick={() => upload(false)}
                >
                  <UploadIcon />
                  Đăng ngay
                </Button>
              </>
            )}

            <div className="flex items-center gap-2">
              <Label htmlFor="autopublish" className="text-muted-foreground text-xs">
                Sau khi dựng xong
              </Label>
              <Select
                value={detail?.autoPublish ?? 'schedule'}
                disabled={running || publish.phase === 'pending'}
                onValueChange={(value) => {
                  publish.track(
                    (async () => {
                      try {
                        await apiJson(`/projects/${projectId}/auto-publish`, 'PUT', {
                          autoPublish: value,
                        });
                        await load();
                        onChanged();
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : String(err));
                        // Rethrown so the mark beside it turns into a cross;
                        // the toast alone scrolls away, the control does not.
                        throw err;
                      }
                    })(),
                  );
                }}
              >
                <SelectTrigger id="autopublish" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="schedule">Lên lịch</SelectItem>
                  <SelectItem value="none">Không đăng</SelectItem>
                  <SelectItem value="now">Đăng luôn</SelectItem>
                </SelectContent>
              </Select>

              <span
                className={cn(
                  'inline-flex',
                  publish.phase === 'done'
                    ? 'text-success'
                    : publish.phase === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                )}
              >
                <ActionMark phase={publish.phase} />
              </span>
            </div>

            <p className="text-muted-foreground basis-full text-xs">
              Chạy hết mọi bước: nghĩ đề tài (nếu chưa có) → kịch bản →{' '}
              {isPodcast() ? 'chọn ảnh' : 'tìm ảnh'} → giọng đọc → dựng → kiểm tra
              {detail?.autoPublish !== 'none' ? ' → đăng YouTube' : ''}. Bấm vào từng ô
              phía trên để xem chi tiết bước đó.
            </p>
          </div>
        </section>

        <Separator />

        {/* ---- Backdrops (podcast only) -------------------------------- */}
        {isPodcast() && detail?.library && (
          <>
            <ScenePicker
              library={detail.library}
              picked={detail.brief?.environments ?? []}
              disabled={running}
              onChange={(environments) => saveBrief({ environments })}
            />
            <Separator />
          </>
        )}

        <Separator />
        <div className="flex justify-between">
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => (confirm('Xoá hẳn dự án này?') ? remove() : undefined)}
            disabled={running}
          >
            <Trash2Icon />
            Xoá dự án
          </Button>
          <div className="flex items-center gap-4">
            {/* Only once it is actually up: a link that 404s is worse than no
                link, and `youtubeUrl` is written after a successful upload. */}
            {detail?.youtubeUrl && (
              <a
                href={detail.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1.5 text-xs hover:underline"
              >
                <ExternalLinkIcon className="size-3.5" />
                Xem trên YouTube
              </a>
            )}
            {detail?.youtubeChannel && (
              <span className="text-muted-foreground text-xs">
                <SparklesIcon className="mr-1 inline size-3" />
                Kênh: {detail.youtubeChannel.title}
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
