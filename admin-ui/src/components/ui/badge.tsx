import React from 'react';
import { JobStatus } from '../../lib/api';

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

// Dark-surface tuned for WCAG AA (>=4.5:1) contrast against slate-950/900 backgrounds.
const STATUS_CLASSES: Record<JobStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-400/40',
  processing: 'bg-blue-500/15 text-blue-300 border-blue-400/40',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40',
  failed: 'bg-red-500/15 text-red-300 border-red-400/40',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'processing' ? 'animate-pulse-soft motion-reduce:animate-none' : ''
        }`}
        style={{ backgroundColor: 'currentColor' }}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
