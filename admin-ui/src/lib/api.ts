export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobResponse {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobListEnvelope {
  items: JobResponse[];
  count: number;
}

export type ErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'RETRY_LIMIT_EXCEEDED'
  | 'JOB_IN_PROGRESS'
  | 'VALIDATION_FAILED'
  | string;

export interface ApiErrorEnvelope {
  code: ErrorCode;
  message: string;
  details?: Array<{ field: string; reason: string }>;
}

export class ApiError extends Error {
  code: ErrorCode;
  details?: Array<{ field: string; reason: string }>;
  status: number;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.status = status;
    this.code = envelope.code;
    this.details = envelope.details;
  }
}

const BASE = '/jobs';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const envelope: ApiErrorEnvelope = body ?? {
      code: 'UNKNOWN_ERROR',
      message: res.statusText || 'Request failed',
    };
    throw new ApiError(res.status, envelope);
  }

  return body as T;
}

export function listJobs(): Promise<JobListEnvelope> {
  return request<JobListEnvelope>('');
}

export interface SearchParams {
  title?: string;
  status?: JobStatus | '';
}

export function searchJobs(params: SearchParams): Promise<JobListEnvelope> {
  const title = params.title?.trim() ?? '';
  const status = params.status ?? '';

  if (!title && !status) {
    // Backend requires >=1 param; both empty must fall back to plain list.
    return listJobs();
  }

  const qs = new URLSearchParams();
  if (title) qs.set('title', title);
  if (status) qs.set('status', status);

  return request<JobListEnvelope>(`/search?${qs.toString()}`);
}

export function getJob(id: string): Promise<JobResponse> {
  return request<JobResponse>(`/${id}`);
}

export interface CreateJobBody {
  title: string;
  description?: string;
}

export function createJob(body: CreateJobBody): Promise<JobResponse> {
  return request<JobResponse>('', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface PatchJobBody {
  title?: string;
  description?: string;
  status?: 'pending';
}

export function patchJob(id: string, body: PatchJobBody): Promise<JobResponse> {
  return request<JobResponse>(`/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteJob(id: string): Promise<void> {
  await request<void>(`/${id}`, { method: 'DELETE' });
}
