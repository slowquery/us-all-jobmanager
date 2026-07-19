import * as DialogPrimitive from '@radix-ui/react-dialog';
import React, { useEffect, useState } from 'react';
import { ApiError, JobResponse, patchJob } from '../lib/api';
import { useToast } from './ui/toast';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import { formatKst } from '../lib/format';

export function JobDetailDialog({
  job,
  onOpenChange,
  onUpdated,
}: {
  job: JobResponse | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (job: JobResponse) => void;
}) {
  const { show } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (job) {
      setTitle(job.title);
      setDescription(job.description ?? '');
    }
  }, [job]);

  if (!job) return null;

  const dirty = title !== job.title || description !== (job.description ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await patchJob(job.id, { title, description });
      onUpdated(updated);
      show('작업이 저장되었습니다', 'success');
      // 저장 성공 시 다이얼로그를 닫는다(수정 완료 후 목록으로 복귀).
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        show(err.message || err.code, 'error');
      } else {
        show('저장에 실패했습니다', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const updated = await patchJob(job.id, { status: 'pending' });
      onUpdated(updated);
      show('재시도 대기열에 등록되었습니다', 'success');
    } catch (err) {
      if (err instanceof ApiError) {
        show(err.message || err.code, 'error');
      } else {
        show('재시도에 실패했습니다', 'error');
      }
    } finally {
      setRetrying(false);
    }
  };

  return (
    <DialogPrimitive.Root open={!!job} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="detail-dialog"
          onEscapeKeyDown={() => onOpenChange(false)}
          className="surface-card fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6 shadow-xl focus:outline-none"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <DialogPrimitive.Title className="text-lg font-semibold text-slate-50">
              작업 상세
            </DialogPrimitive.Title>
            <StatusBadge status={job.status} />
          </div>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              제목
              <input
                data-testid="detail-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="focus-ring rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              설명
              <textarea
                data-testid="detail-description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="focus-ring rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-slate-100"
              />
            </label>

            <dl className="grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div>
                <dt className="uppercase tracking-wide">Created</dt>
                <dd>{formatKst(job.createdAt)}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wide">Updated</dt>
                <dd>{formatKst(job.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <div>
              {job.status === 'failed' && (
                <Button
                  variant="secondary"
                  data-testid="retry-btn"
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? '재시도 중...' : '재시도'}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <DialogPrimitive.Close asChild>
                <Button variant="ghost">닫기</Button>
              </DialogPrimitive.Close>
              <Button
                data-testid="detail-save-btn"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
