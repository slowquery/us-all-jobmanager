import React from 'react';
import { JobResponse } from '../lib/api';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { formatKst } from '../lib/format';

export function JobsTable({
  jobs,
  onRowClick,
  onDeleteRequest,
}: {
  jobs: JobResponse[];
  onRowClick: (job: JobResponse) => void;
  onDeleteRequest: (job: JobResponse) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div
        data-testid="empty-state"
        className="surface-card flex flex-col items-center justify-center gap-2 p-12 text-center text-slate-400"
      >
        <p className="text-base font-medium text-slate-200">표시할 작업이 없습니다</p>
        <p className="text-sm">검색 조건을 변경하거나 새 작업을 생성해 보세요.</p>
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-surface-border bg-slate-900/40 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Title
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Updated
            </th>
            <th scope="col" className="px-4 py-3 font-medium text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const isProcessing = job.status === 'processing';
            return (
              <tr
                key={job.id}
                data-testid="job-row"
                data-job-id={job.id}
                data-status={job.status}
                tabIndex={0}
                role="button"
                aria-label={`${job.title} 상세 보기`}
                onClick={() => onRowClick(job)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(job);
                  }
                }}
                className="focus-ring cursor-pointer border-b border-surface-border/70 last:border-0 hover:bg-slate-800/40"
              >
                <td className="px-4 py-3 text-slate-100">{job.title}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {formatKst(job.updatedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  {isProcessing ? (
                    <Tooltip content="진행 중 작업은 삭제할 수 없습니다">
                      <span className="inline-block">
                        <Button
                          variant="danger"
                          data-testid="delete-btn"
                          disabled
                          onClick={(e) => e.stopPropagation()}
                        >
                          삭제
                        </Button>
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="danger"
                      data-testid="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRequest(job);
                      }}
                    >
                      삭제
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
