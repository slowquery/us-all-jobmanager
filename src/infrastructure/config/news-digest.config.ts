/**
 * 뉴스 다이제스트 JobProcessor(뉴스→Gemini→Slack) 설정 값 모음.
 *
 * 비밀(Gemini API key·Slack webhook URL)은 절대 코드/저장소에 하드코딩하지 않고 환경변수(.env)로만
 * 주입한다(저장소 PUBLIC 전제). 이 설정 읽기는 infrastructure 계층 책임이며 domain/application은
 * 이 타입을 알지 못한다(Rule 3, 헥사고날 경계).
 */
export interface NewsDigestConfig {
  /** 기능 플래그. `NEWS_DIGEST_ENABLED=true`이고 필수 비밀(apiKey·webhook)이 모두 있을 때만 true. 기본 off. */
  enabled: boolean;
  /** 이 제목(title)을 가진 job만 뉴스 파이프라인으로 라우팅된다(DispatchingJobProcessor sentinel). 기본 `news-digest`. */
  jobTitle: string;
  /** 오늘의 뉴스 헤드라인을 가져올 RSS/피드 URL. 기본은 구글 뉴스 RSS(키 불필요). */
  newsFeedUrl: string;
  /** Gemini에 넘길 최대 헤드라인 수(과도한 프롬프트·비용 방지). 기본 15. */
  maxHeadlines: number;
  /** Gemini API key(비밀, env-only). 미설정 시 enabled=false. */
  geminiApiKey: string;
  /** Gemini 생성 모델 이름. 기본 `gemini-flash-lite-latest`(무료 티어·저지연). 사용 가능 모델은 Generative Language API의 ListModels로 확인. */
  geminiModel: string;
  /** Slack Incoming Webhook URL(비밀, env-only). 미설정 시 enabled=false. */
  slackWebhookUrl: string;
  /** 뉴스 처리 파이프라인 전체 timeout(ms) — fetch+Gemini+Slack 호출 합산 상한. 초과 시 진행 중 호출을 abort해 tick 무한 지연을 막는다. 기본 10000. */
  timeoutMs: number;
}

/** `NEWS_DIGEST_JOB_TITLE` 기본값 — 뉴스 파이프라인으로 라우팅되는 job의 제목 sentinel. */
export const DEFAULT_NEWS_DIGEST_JOB_TITLE = 'news-digest';

/** 헤드라인 소스 기본값 — 구글 뉴스(한국) RSS. API 키가 필요 없어 데모 기본으로 안전하다. */
export const DEFAULT_NEWS_FEED_URL = 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko';

/** Gemini 생성 모델 기본값(무료 티어). */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';

/** 외부 호출 timeout 기본값(ms). */
export const DEFAULT_NEWS_DIGEST_TIMEOUT_MS = 10_000;

/** 헤드라인 최대 수 기본값. */
export const DEFAULT_MAX_HEADLINES = 15;

/**
 * 환경변수에서 뉴스 다이제스트 설정을 읽어 정규화한다.
 *
 * `enabled`는 명시적 opt-in(`NEWS_DIGEST_ENABLED=true`)이면서 필수 비밀(Gemini key·Slack webhook)이
 * 모두 존재할 때만 true다 — 플래그만 켜고 비밀이 없으면 스케줄러가 뉴스 어댑터를 배선하지 않고
 * 안전하게 no-op 처리기로 남겨야 하기 때문이다.
 *
 * @param env 읽어들일 환경변수 소스(기본 `process.env`). 테스트에서 주입 가능.
 * @returns 정규화된 {@link NewsDigestConfig}
 */
export function readNewsDigestConfig(env: Record<string, string | undefined> = process.env): NewsDigestConfig {
  const geminiApiKey = (env.GEMINI_API_KEY ?? '').trim();
  const slackWebhookUrl = (env.SLACK_WEBHOOK_URL ?? '').trim();
  const flag = (env.NEWS_DIGEST_ENABLED ?? '').trim().toLowerCase() === 'true';
  const timeoutRaw = Number.parseInt((env.NEWS_DIGEST_TIMEOUT_MS ?? '').trim(), 10);
  const maxHeadlinesRaw = Number.parseInt((env.NEWS_DIGEST_MAX_HEADLINES ?? '').trim(), 10);

  return {
    enabled: flag && geminiApiKey.length > 0 && slackWebhookUrl.length > 0,
    jobTitle: (env.NEWS_DIGEST_JOB_TITLE ?? '').trim() || DEFAULT_NEWS_DIGEST_JOB_TITLE,
    newsFeedUrl: (env.NEWS_FEED_URL ?? '').trim() || DEFAULT_NEWS_FEED_URL,
    maxHeadlines: Number.isFinite(maxHeadlinesRaw) && maxHeadlinesRaw > 0 ? maxHeadlinesRaw : DEFAULT_MAX_HEADLINES,
    geminiApiKey,
    geminiModel: (env.GEMINI_MODEL ?? '').trim() || DEFAULT_GEMINI_MODEL,
    slackWebhookUrl,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_NEWS_DIGEST_TIMEOUT_MS,
  };
}
