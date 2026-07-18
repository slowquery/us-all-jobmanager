import { useCallback, useEffect, useRef, useState } from 'react';
import { JobResponse, JobStatus, listJobs, searchJobs } from '../lib/api';

const POLL_INTERVAL_MS = 5000;

export interface UseJobsResult {
  jobs: JobResponse[];
  count: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useJobs(titleQuery: string, statusFilter: JobStatus | ''): UseJobsResult {
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramsRef = useRef({ titleQuery, statusFilter });
  paramsRef.current = { titleQuery, statusFilter };

  const fetchJobs = useCallback(async () => {
    const { titleQuery: title, statusFilter: status } = paramsRef.current;
    try {
      const envelope =
        title.trim() || status ? await searchJobs({ title, status }) : await listJobs();
      setJobs(envelope.items);
      setCount(envelope.count);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [titleQuery, statusFilter, fetchJobs]);

  useEffect(() => {
    let intervalId: number | undefined;

    const startPolling = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => {
        fetchJobs();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchJobs();
        startPolling();
      }
    };

    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchJobs]);

  return { jobs, count, loading, error, refresh };
}
