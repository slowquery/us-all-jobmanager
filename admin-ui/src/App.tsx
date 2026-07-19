import React, { useState } from 'react';
import { ApiError, JobResponse, JobStatus, deleteJob } from './lib/api';
import { useJobs } from './hooks/use-jobs';
import { useDebouncedValue } from './hooks/use-debounce';
import { StatTiles } from './components/stat-tiles';
import { JobsTable } from './components/jobs-table';
import { JobDetailDialog } from './components/job-detail-dialog';
import { CreateJobDialog } from './components/create-job-dialog';
import { ConfirmDialog } from './components/ui/alert-dialog';
import { Button } from './components/ui/button';
import { TooltipProvider } from './components/ui/tooltip';
import { ToastProvider, useToast } from './components/ui/toast';

const STATUS_OPTIONS: Array<{ value: JobStatus | ''; label: string }> = [
  { value: '', label: '전체 상태' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

function AdminPage() {
  const [titleInput, setTitleInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  const debouncedTitle = useDebouncedValue(titleInput, 300);
  const { jobs, loading, error, refresh } = useJobs(debouncedTitle, statusFilter);
  const { show } = useToast();

  const [selectedJob, setSelectedJob] = useState<JobResponse | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobResponse | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const handleUpdated = (updated: JobResponse) => {
    setSelectedJob(updated);
    refresh();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteJob(target.id);
      show('작업이 삭제되었습니다', 'success');
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'NOT_FOUND') {
          show('이미 삭제된 작업입니다', 'error');
          refresh();
        } else if (err.code === 'JOB_IN_PROGRESS') {
          show('진행 중 작업은 삭제할 수 없습니다', 'error');
        } else {
          show(err.message || err.code, 'error');
        }
      } else {
        show('삭제에 실패했습니다', 'error');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-slate-50">Job Manager Admin</h1>
          <p className="text-sm text-slate-400">작업 목록을 검색하고 관리합니다.</p>
        </header>

        <StatTiles jobs={jobs} />

        <div className="surface-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <input
              data-testid="search-input"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="제목으로 검색..."
              className="focus-ring flex-1 rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <select
              data-testid="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as JobStatus | '')}
              className="focus-ring rounded-card border border-surface-border bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            data-testid="new-job-btn"
            onClick={() => setCreateOpen(true)}
          >
            새 작업
          </Button>
          <Button
            variant="secondary"
            data-testid="refresh-btn"
            onClick={() => refresh()}
            disabled={loading}
          >
            {loading ? '새로고침 중...' : '새로고침'}
          </Button>
        </div>

        {error && (
          <div className="surface-card border border-status-failed/40 p-4 text-sm text-red-300">
            목록을 불러오지 못했습니다: {error}
          </div>
        )}

        <JobsTable
          jobs={jobs}
          onRowClick={(job) => setSelectedJob(job)}
          onDeleteRequest={(job) => setPendingDelete(job)}
        />
      </div>

      <JobDetailDialog
        job={selectedJob}
        onOpenChange={(open) => {
          if (open) return;
          const rowId = selectedJob?.id;
          setSelectedJob(null);
          // 접근성: 다이얼로그가 닫히면 열었던 행으로 포커스를 되돌린다(포커스가 body로 흩어지지 않게).
          if (rowId) {
            requestAnimationFrame(() => {
              const el = document.querySelector(`[data-job-id="${rowId}"]`);
              if (el instanceof HTMLElement) el.focus();
            });
          }
        }}
        onUpdated={handleUpdated}
      />

      <CreateJobDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refresh()}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="작업을 삭제하시겠습니까?"
        description={pendingDelete ? `"${pendingDelete.title}" 작업이 영구적으로 삭제됩니다.` : ''}
        onConfirm={handleConfirmDelete}
        testId="delete-confirm-dialog"
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <TooltipProvider>
        <AdminPage />
      </TooltipProvider>
    </ToastProvider>
  );
}
