import { DefaultJobProcessor, DispatchingJobProcessor, JobProcessor } from '../../application/ports/job-processor.strategy';
import { LoggerPort } from '../../application/ports/logger.port';
import { NewsDigestConfig } from '../../infrastructure/config/news-digest.config';
import { GeminiNewsDigestBuilder } from '../../infrastructure/news-digest/gemini-news-digest-builder';
import { HttpNewsSource } from '../../infrastructure/news-digest/http-news-source';
import { InMemoryDeliveryLedger } from '../../infrastructure/news-digest/in-memory-delivery-ledger';
import { NewsDigestJobProcessor } from '../../infrastructure/news-digest/news-digest-job.processor';
import { WebhookSlackNotifier } from '../../infrastructure/news-digest/webhook-slack-notifier';
import { TracingJobProcessor } from './tracing-job.processor';

/**
 * 스케줄러 `JOB_PROCESSOR` 바인딩을 조립하는 순수 팩토리(등록/호출 설계의 합류 지점).
 *
 * 설정(`NewsDigestConfig`)에 따라 처리기를 다음과 같이 구성한다:
 * - **비활성(기본)**: `DefaultJobProcessor`(처리=전이)만 사용한다 — 기존 동작과 완전히 동일하다.
 * - **활성(뉴스 플래그 on + 비밀 존재)**: 제목이 `config.jobTitle` sentinel과 일치하는 job만
 *   {@link NewsDigestJobProcessor}(뉴스→Gemini→Slack)로 라우팅하고 나머지는 `DefaultJobProcessor`로
 *   보내는 {@link DispatchingJobProcessor}를 구성한다. 이로써 전역 단일 바인딩이면서도 "뉴스 job만
 *   뉴스 처리"가 되어, API로 생성된 일반 job이 외부 전송을 타는 사고를 막는다(도메인 스키마 무변경).
 *
 * 구성한 delegate는 항상 {@link TracingJobProcessor}로 감싸 job별 스팬 계측을 보존한다(어떤 delegate든
 * 래핑 유지). 뉴스 어댑터의 실제 HTTP/Gemini/Slack 구현체는 전부 infrastructure 계층이며, 이 팩토리는
 * adapters 계층의 합성(composition) 지점으로서 그것들을 조립만 한다(infrastructure→adapters 역참조 없음).
 *
 * @param config 환경변수에서 읽은 뉴스 다이제스트 설정
 * @param logger 뉴스 처리 실패를 기록할 로거 포트
 * @returns 스케줄러가 사용할 `JOB_PROCESSOR` 구현(Tracing으로 감싼 상태)
 */
export function createSchedulerJobProcessor(config: NewsDigestConfig, logger: LoggerPort): JobProcessor {
  const fallback = new DefaultJobProcessor();
  if (!config.enabled) {
    return new TracingJobProcessor(fallback);
  }

  const newsProcessor = new NewsDigestJobProcessor({
    newsSource: new HttpNewsSource(config.newsFeedUrl, config.maxHeadlines),
    builder: new GeminiNewsDigestBuilder(config.geminiApiKey, config.geminiModel),
    notifier: new WebhookSlackNotifier(config.slackWebhookUrl),
    ledger: new InMemoryDeliveryLedger(),
    timeoutMs: config.timeoutMs,
    model: config.geminiModel,
    logger,
  });

  const dispatching = new DispatchingJobProcessor(
    (job) => job.title === config.jobTitle,
    newsProcessor,
    fallback,
  );

  return new TracingJobProcessor(dispatching);
}
