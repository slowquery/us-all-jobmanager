import React, { useMemo } from 'react';
import { JobResponse } from '../lib/api';

const TILES: Array<{ key: 'total' | 'pending' | 'processing' | 'completed' | 'failed'; label: string; dot?: string }> = [
  { key: 'total', label: 'Total' },
  { key: 'pending', label: 'Pending', dot: 'bg-status-pending' },
  { key: 'processing', label: 'Processing', dot: 'bg-status-processing' },
  { key: 'completed', label: 'Completed', dot: 'bg-status-completed' },
  { key: 'failed', label: 'Failed', dot: 'bg-status-failed' },
];

export function StatTiles({ jobs }: { jobs: JobResponse[] }) {
  const counts = useMemo(() => {
    const base = { total: jobs.length, pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const job of jobs) {
      base[job.status] += 1;
    }
    return base;
  }, [jobs]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((tile) => (
        <div
          key={tile.key}
          data-testid={`stat-${tile.key}`}
          className="surface-card flex flex-col gap-1 p-4"
        >
          <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
            {tile.dot && <span className={`h-1.5 w-1.5 rounded-full ${tile.dot}`} aria-hidden="true" />}
            {tile.label}
          </span>
          <span className="text-2xl font-semibold text-slate-50">{counts[tile.key]}</span>
        </div>
      ))}
    </div>
  );
}
