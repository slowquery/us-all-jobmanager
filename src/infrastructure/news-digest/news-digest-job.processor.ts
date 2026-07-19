import { Span, trace } from '@opentelemetry/api';
import { LoggerPort } from '../../application/ports/logger.port';
import { JobProcessOutcome, JobProcessor } from '../../application/ports/job-processor.strategy';
import { Job } from '../../domain/job';
import { formatDigestMessage } from './digest-message';
import {
  DeliveryLedger,
  NewsDigestBuilder,
  NewsSource,
  SlackNotifier,
  deriveDeliveryKey,
} from './news-digest.ports';

/** 뉴스 다이제스트 처리 단계별 스팬을 여는 OTel 트레이서 이름(관측성: Tempo 단계별 소요시간). */
const NEWS_DIGEST_TRACER_NAME = 'us-all-job-manager-news-digest';

/** `NewsDigestJobProcessor` 생성자가 받는 협력자·설정 묶음. */
export interface NewsDigestJobProcessorDeps {
  /** 오늘의 기사 소스. */
  newsSource: NewsSource;
  /** 기사를 주제별 그룹으로 묶고 요약하는 빌더. */
  builder: NewsDigestBuilder;
  /** 결과 메시지를 전송하는 알림기. */
  notifier: SlackNotifier;
  /** 중복 전송 방지 원장. */
  ledger: DeliveryLedger;
  /** 파이프라인 전체 timeout(ms). */
  timeoutMs: number;
  /** 사용 모델명(관측성 로그·스팬 속성). */
  model: string;
  /** 실패·결과 관측 로그를 남길 로거(선택). */
  logger?: LoggerPort;
}

/**
 * 한 단계를 자식 스팬으로 감싸 실행한다. OTel SDK 미초기화 시(테스트)에는 no-op 스팬이라 부작용이 없다.
 * @param name 스팬 이름(예: `news.fetch`)
 * @param run 스팬 컨텍스트에서 실행할 함수
 * @returns `run`의 반환값
 */
async function withSpan<T>(name: string, run: (span: Span) => Promise<T>): Promise<T> {
  return trace.getTracer(NEWS_DIGEST_TRACER_NAME).startActiveSpan(name, async (span) => {
    try {
      return await run(span);
    } finally {
      span.end();
    }
  });
}

/**
 * "뉴스 다이제스트" job을 처리하는 `JobProcessor` 구현체.
 *
 * 파이프라인: 기사 조회(`news.fetch`) → 주제별 그룹핑·요약(`news.summarize`) → Slack 전송(`news.notify`).
 * 각 단계는 자식 스팬으로 계측되어 Tempo에서 단계별 소요시간이 보이고, 처리 1건마다 `digest` 로그
 * 이벤트(소요시간·기사수·그룹수·결과)를 남겨 Loki/Grafana가 실행시간·처리속도를 집계한다.
 *
 * **오류 계약(no-throw)**: 예외·timeout·비정상 응답을 포함한 모든 오류를 `{ outcome: 'failed' }`로
 * 매핑하며 절대 throw하지 않는다. 파이프라인 전체에 `AbortController` timeout을 부과하고, 전송 완료한
 * `job.id`를 원장에 기록해 재처리 중복 전송을 줄인다(defense-in-depth, at-least-once 수용).
 */
export class NewsDigestJobProcessor implements JobProcessor {
  /** @param deps 처리에 필요한 협력자·설정 묶음 */
  constructor(private readonly deps: NewsDigestJobProcessorDeps) {}

  /**
   * job 1건을 처리한다.
   * @param job 처리 대상 job(이미 `processing`으로 전이 커밋된 최신 상태)
   * @returns 처리 결과(`completed` 또는 `failed`). 절대 reject되지 않는다.
   */
  async process(job: Job): Promise<JobProcessOutcome> {
    const {
      newsSource,
      builder,
      notifier,
      ledger,
      timeoutMs,
      model,
      logger,
    } = this.deps;
    const key = deriveDeliveryKey(job);
    if (ledger.wasDelivered(key)) {
      return { outcome: 'completed' };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let articleCount = 0;
    let groupCount = 0;
    try {
      const articles = await withSpan('news.fetch', async (span) => {
        const result = await newsSource.fetchTodayArticles(controller.signal);
        span.setAttribute('news.article_count', result.length);
        return result;
      });
      articleCount = articles.length;
      if (articles.length === 0) {
        throw new Error('오늘의 기사가 비어 있음');
      }

      const groups = await withSpan('news.summarize', async (span) => {
        span.setAttribute('news.model', model);
        const result = await builder.buildGroupedDigest(articles, controller.signal);
        span.setAttribute('news.group_count', result.length);
        return result;
      });
      groupCount = groups.length;
      if (groups.length === 0) {
        throw new Error('생성된 다이제스트 그룹이 없음');
      }

      const text = formatDigestMessage(job.title, groups);
      await withSpan('news.notify', async () => {
        await notifier.notify(text, controller.signal);
      });

      ledger.markDelivered(key);
      this.emitDigestLog(logger, 'completed', Date.now() - startedAt, articleCount, groupCount, model);
      return { outcome: 'completed' };
    } catch {
      this.emitDigestLog(logger, 'failed', Date.now() - startedAt, articleCount, groupCount, model);
      logger?.log({
        type: 'error',
        level: 'error',
        source: 'scheduler',
        message: `news digest failed for job ${job.id}`,
        errorCode: 'NEWS_DIGEST_FAILED',
      });
      return { outcome: 'failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 관측성용 `digest` 이벤트를 남긴다(레벨은 항상 info — 오류 신호는 별도 error 이벤트가 담당). */
  private emitDigestLog(
    logger: LoggerPort | undefined,
    outcome: 'completed' | 'failed',
    digestDurationMs: number,
    articleCount: number,
    groupCount: number,
    model: string,
  ): void {
    logger?.log({
      type: 'digest',
      level: 'info',
      source: 'scheduler',
      message: `news digest ${outcome}`,
      outcome,
      digestDurationMs,
      articleCount,
      groupCount,
      model,
    });
  }
}
