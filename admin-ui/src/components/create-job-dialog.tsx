import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ApiError, JobResponse, createJob } from '../lib/api';
import { useToast } from './ui/toast';
import { Button } from './ui/button';

/** 새 작업 생성 다이얼로그. `POST /jobs`를 호출한다(상태는 서버가 항상 pending으로 고정). */
export function CreateJobDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (job: JobResponse) => void;
}) {
  const { show } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 다이얼로그가 열릴 때마다 입력을 초기화한다.
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      show('제목을 입력하세요', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createJob({ title: title.trim(), description: description.trim() || undefined });
      onCreated(created);
      show('작업이 생성되었습니다', 'success');
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) {
        show(err.details?.[0]?.reason || err.message || err.code, 'error');
      } else {
        show('작업 생성에 실패했습니다', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          data-testid="create-dialog"
          onEscapeKeyDown={() => onOpenChange(false)}
          className="surface-card fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="mb-4 text-lg font-semibold text-slate-50">
            새 작업 생성
          </DialogPrimitive.Title>

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              제목
              <input
                data-testid="create-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="작업 제목"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                className="focus-ring rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              설명 (선택)
              <textarea
                data-testid="create-description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="작업 설명"
                className="focus-ring rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-slate-100"
              />
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">취소</Button>
            </DialogPrimitive.Close>
            <Button
              data-testid="create-submit-btn"
              onClick={handleSubmit}
              disabled={!title.trim() || submitting}
            >
              {submitting ? '생성 중...' : '생성'}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
