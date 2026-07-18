import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TracingJobProcessor } from './tracing-job.processor';
import { JobProcessor } from '../../application/ports/job-processor.strategy';
import { makeJob } from '../../application/testing/job.fixture';

describe('TracingJobProcessor', () => {
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  });

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    trace.disable();
    exporter.reset();
  });

  it('위임한 JobProcessor의 process를 호출하고 결과를 그대로 반환한다', async () => {
    const delegate: JobProcessor = { process: jest.fn().mockResolvedValue({ outcome: 'completed' }) };
    const processor = new TracingJobProcessor(delegate);
    const job = makeJob({
      id: 'job-1',
      status: 'processing',
    });

    const outcome = await processor.process(job);

    expect(outcome).toEqual({ outcome: 'completed' });
    expect(delegate.process).toHaveBeenCalledWith(job);
  });

  it('job 처리마다 scheduler.process-job 스팬을 열고 job.id/job.outcome 속성을 기록한 뒤 종료한다', async () => {
    const delegate: JobProcessor = { process: jest.fn().mockResolvedValue({ outcome: 'failed' }) };
    const processor = new TracingJobProcessor(delegate);
    const job = makeJob({
      id: 'job-42',
      status: 'processing',
    });

    await processor.process(job);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('scheduler.process-job');
    expect(spans[0].attributes['job.id']).toBe('job-42');
    expect(spans[0].attributes['job.outcome']).toBe('failed');
  });

  it('위임 처리가 예외를 던져도 스팬을 종료하고 예외를 그대로 전파한다', async () => {
    const delegate: JobProcessor = { process: jest.fn().mockRejectedValue(new Error('boom')) };
    const processor = new TracingJobProcessor(delegate);
    const job = makeJob({
      id: 'job-err',
      status: 'processing',
    });

    await expect(processor.process(job)).rejects.toThrow('boom');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('scheduler.process-job');
  });
});
