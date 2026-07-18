import { randomUUID } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JOB_REPOSITORY, LOGGER_PORT } from '../src/adapters/tokens';
import { Job } from '../src/domain/job';
import { MAX_RETRY_COUNT } from '../src/domain/job-transitions';
import { FileLoggerAdapter } from '../src/infrastructure/logging/file-logger.adapter';
import { JsonDbJobRepository } from '../src/infrastructure/persistence/json-db-job.repository';

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

function makeSeedJob(overrides: Partial<Job>): Job {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'seed title',
    description: 'seed description',
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * 특정 조건을 만족하는 로그 이벤트가 파일에 나타날 때까지 폴링한다.
 * 라인 수 기준 대기는 이벤트 도착 순서(lock/transition이 http_request보다 먼저 flush될 수 있음)에
 * 취약하므로, 상관 검증처럼 특정 이벤트의 존재가 전제인 테스트는 이 predicate 대기를 사용한다.
 *
 * @param path - NDJSON 로그 파일 경로
 * @param predicate - 파싱된 전체 이벤트 배열이 조건을 충족하는지 판정
 * @returns 조건 충족 시점의 파싱된 이벤트 배열
 */
async function waitForLogEvents(
  path: string,
  predicate: (events: any[]) => boolean,
  timeoutMs = 2000,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf-8').trim().split('\n').filter((line) => line.length > 0);
      const events = lines.map((line) => JSON.parse(line));
      if (predicate(events)) {
        return events;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for matching log events at ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Jobs API (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  let dbPath: string;
  let logPath: string;
  let seededCompleted: Job;
  let seededRetryExceeded: Job;
  let seededRetrySuccess: Job;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'jobs-e2e-'));
    dbPath = join(dir, 'jobs.json');
    logPath = join(dir, 'logs.txt');

    // 409 두 사유(INVALID_TRANSITION/RETRY_LIMIT_EXCEEDED)와 재시도 성공 케이스는 API로 재현
    // 불가능한 상태 조합이라(completed/failed 전이는 스케줄러 전용) 임시 DB 파일에 직접 시딩한다.
    // node-json-db는 최초 로드 이후 인메모리 캐시를 사용하므로, app.init() 이전에 한 번에 시딩한다.
    seededCompleted = makeSeedJob({ status: 'completed' });
    seededRetryExceeded = makeSeedJob({ status: 'failed', retryCount: MAX_RETRY_COUNT });
    seededRetrySuccess = makeSeedJob({ status: 'failed', retryCount: 0 });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seededCompleted, seededRetryExceeded, seededRetrySuccess] }));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_PORT)
      .useFactory({ factory: () => new FileLoggerAdapter(logPath) })
      .overrideProvider(JOB_REPOSITORY)
      .useFactory({
        factory: (logger: FileLoggerAdapter) => new JsonDbJobRepository(dbPath, logger),
        inject: [LOGGER_PORT],
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('POST /jobs', () => {
    it('유효한 요청은 201과 pending 상태의 job을 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs')
        .send({ title: 'Task 1', description: 'Do something' })
        .expect(201);

      expect(response.body).toMatchObject({
        title: 'Task 1',
        description: 'Do something',
        status: 'pending',
      });
      expect(typeof response.body.id).toBe('string');
      expect(response.body.createdAt).toBe(response.body.updatedAt);
      expect(response.body.retryCount).toBeUndefined();
    });

    it('title 누락은 400 VALIDATION_FAILED envelope을 반환한다', async () => {
      const response = await request(app.getHttpServer()).post('/jobs').send({ description: 'no title' }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(typeof response.body.message).toBe('string');
      expect(Array.isArray(response.body.details)).toBe(true);
    });

    it('DTO에 없는 필드(status)를 보내면 whitelist 위반으로 400을 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/jobs')
        .send({ title: 'Task', status: 'processing' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /jobs', () => {
    it('생성된 job을 목록으로 반환한다', async () => {
      await request(app.getHttpServer()).post('/jobs').send({ title: 'Listed job', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer()).get('/jobs').expect(200);

      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.count).toBe(response.body.items.length);
      expect(response.body.items.some((job: Job) => job.title === 'Listed job')).toBe(true);
    });
  });

  describe('GET /jobs/search', () => {
    it('title 부분일치로 검색한다', async () => {
      await request(app.getHttpServer()).post('/jobs').send({ title: 'Deploy service', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer()).get('/jobs/search').query({ title: 'deploy' }).expect(200);

      expect(response.body.items.some((job: Job) => job.title === 'Deploy service')).toBe(true);
    });

    it('status enum으로 검색한다', async () => {
      const response = await request(app.getHttpServer()).get('/jobs/search').query({ status: 'completed' }).expect(200);

      expect(response.body.items.every((job: Job) => job.status === 'completed')).toBe(true);
      expect(response.body.items.some((job: Job) => job.id === seededCompleted.id)).toBe(true);
    });

    it('title/status 둘 다 없으면 400 VALIDATION_FAILED를 반환한다', async () => {
      const response = await request(app.getHttpServer()).get('/jobs/search').expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('허용되지 않는 status 값은 400을 반환한다', async () => {
      const response = await request(app.getHttpServer()).get('/jobs/search').query({ status: 'bogus' }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /jobs/:id', () => {
    it('존재하는 job을 200으로 반환한다', async () => {
      const created = await request(app.getHttpServer()).post('/jobs').send({ title: 'Findable', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer()).get(`/jobs/${created.body.id}`).expect(200);

      expect(response.body.id).toBe(created.body.id);
    });

    it('존재하지 않는 id는 404 NOT_FOUND를 반환한다', async () => {
      const response = await request(app.getHttpServer()).get('/jobs/does-not-exist').expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /jobs/:id', () => {
    it('title/description만 갱신하면 200과 갱신된 필드를 반환한다', async () => {
      const created = await request(app.getHttpServer()).post('/jobs').send({ title: 'Old', description: 'old desc' }).expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/jobs/${created.body.id}`)
        .send({ title: 'New' })
        .expect(200);

      expect(response.body.title).toBe('New');
      expect(response.body.description).toBe('old desc');
      expect(response.body.status).toBe('pending');
    });

    it('존재하지 않는 id는 404 NOT_FOUND를 반환한다', async () => {
      const response = await request(app.getHttpServer()).patch('/jobs/does-not-exist').send({ title: 'x' }).expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('completed job에 status:pending을 요청하면 409 INVALID_TRANSITION을 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/jobs/${seededCompleted.id}`)
        .send({ status: 'pending' })
        .expect(409);

      expect(response.body.code).toBe('INVALID_TRANSITION');
    });

    it('retryCount 상한에 도달한 failed job의 재시도는 409 RETRY_LIMIT_EXCEEDED를 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/jobs/${seededRetryExceeded.id}`)
        .send({ status: 'pending' })
        .expect(409);

      expect(response.body.code).toBe('RETRY_LIMIT_EXCEEDED');
    });

    it('DTO에 없는 status 값(processing)은 400 VALIDATION_FAILED를 반환한다', async () => {
      const created = await request(app.getHttpServer()).post('/jobs').send({ title: 'x', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/jobs/${created.body.id}`)
        .send({ status: 'processing' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('필드가 하나도 없으면 400 VALIDATION_FAILED를 반환한다', async () => {
      const created = await request(app.getHttpServer()).post('/jobs').send({ title: 'x', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer()).patch(`/jobs/${created.body.id}`).send({}).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('DTO에 없는 필드(atLeastOneField 포함)를 보내면 whitelist 위반으로 400을 반환한다', async () => {
      const created = await request(app.getHttpServer()).post('/jobs').send({ title: 'x', description: 'd' }).expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/jobs/${created.body.id}`)
        .send({ title: 'new', atLeastOneField: 'injected' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('재시도 전이 성공 시 같은 요청 내 http_request/transition 로그가 동일 traceId(32-hex)를 공유한다', async () => {
      const seeded = seededRetrySuccess;

      const response = await request(app.getHttpServer())
        .patch(`/jobs/${seeded.id}`)
        .send({ status: 'pending' })
        .expect(200);
      expect(response.body.status).toBe('pending');

      const events = await waitForLogEvents(logPath, (parsed) => parsed.some(
        (event) => event.method === 'PATCH' && event.path === `/jobs/${seeded.id}`,
      ) && parsed.some((event) => event.jobId === seeded.id && event.actor === 'api'));
      const requestEvent = events.find(
        (event) => event.method === 'PATCH' && event.path === `/jobs/${seeded.id}`,
      );
      const transitionEvent = events.find((event) => event.jobId === seeded.id && event.actor === 'api');

      expect(requestEvent).toBeDefined();
      expect(transitionEvent).toBeDefined();
      expect(transitionEvent.from).toBe('failed');
      expect(transitionEvent.to).toBe('pending');
      expect(requestEvent.traceId).toMatch(TRACE_ID_PATTERN);
      expect(transitionEvent.traceId).toMatch(TRACE_ID_PATTERN);
      expect(requestEvent.traceId).toBe(transitionEvent.traceId);
    });
  });
});
