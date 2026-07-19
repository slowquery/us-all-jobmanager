import { Job } from '../../domain/job';

/**
 * 뉴스 다이제스트 파이프라인의 외부 협력자 seam(포트).
 *
 * `NewsDigestJobProcessor`는 이 인터페이스에만 의존하고 실제 HTTP/Gemini/Slack 호출은 각 구현체가
 * 담당한다 — 덕분에 단위 테스트는 fake를 주입해 네트워크 없이 결정론적으로 검증한다(CI mock 원칙,
 * 실호출 금지). 모든 협력자는 `AbortSignal`을 받아 상위(processor)가 부과한 timeout에 협조한다.
 */

/** RSS 피드에서 뽑은 개별 기사(헤드라인 제목 + 짧은 스니펫 + 링크). */
export interface NewsArticle {
  /** 기사 제목(헤드라인). */
  title: string;
  /** 기사 요약/설명 스니펫(RSS `<description>`에서 추출, 없으면 빈 문자열). */
  snippet: string;
  /** 기사 원문 링크(RSS `<link>`, 없으면 빈 문자열). */
  link: string;
}

/** 오늘의 뉴스 기사 목록을 가져오는 소스(예: 구글 뉴스 RSS). */
export interface NewsSource {
  /**
   * 오늘의 기사 목록(제목+스니펫+링크)을 반환한다.
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  fetchTodayArticles(signal: AbortSignal): Promise<NewsArticle[]>;
}

/** 동일 주제로 묶인 뉴스 그룹(주제 라벨 + 간단 요약 + 소속 헤드라인 목록). */
export interface DigestGroup {
  /** 그룹의 주제 라벨(예: "부동산 정책"). */
  topic: string;
  /** 그룹에 속한 기사들을 관통하는 1~2문장 요약. */
  summary: string;
  /** 이 그룹에 속한 기사 제목(헤드라인) 목록. */
  headlines: string[];
}

/** 기사들을 동일 주제 그룹으로 묶고 각 그룹을 요약하는 빌더(예: Gemini). */
export interface NewsDigestBuilder {
  /**
   * 기사들을 주제별 그룹으로 묶고 각 그룹의 요약을 생성한다.
   * @param articles 그룹핑·요약 대상 기사 목록
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  buildGroupedDigest(articles: NewsArticle[], signal: AbortSignal): Promise<DigestGroup[]>;
}

/** 정리된 텍스트를 외부 채널로 전송하는 알림기(예: Slack Incoming Webhook). */
export interface SlackNotifier {
  /**
   * 메시지를 전송한다.
   * @param text 전송할 텍스트(Slack mrkdwn)
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  notify(text: string, signal: AbortSignal): Promise<void>;
}

/**
 * 이미 전송 완료(`markDelivered`)한 job을 기억해 재처리 시 중복 전송을 줄이는 idempotency 원장(방어적).
 *
 * 인프로세스 메모리 기본 구현이며, 본 파이프라인은 **at-least-once**다: (a) Slack 전송은 성공했으나 이후
 * 처리에서 `failed`로 판정돼 `failed→pending` 재시도되는 경우, (b) 프로세스 재시작으로 원장이 비워진 뒤
 * 재처리되는 경우에 중복 전송이 가능하다(외부 부수효과와 내부 상태의 dual-write 비원자성). `markDelivered`는
 * 전송 성공 시에만 실행되고 `completed`는 종단이라, 원장 조회 경로는 실질적으로 defense-in-depth다.
 * exactly-once는 전송 전 마킹+durable 원장 또는 outbox 패턴이 필요하며 본 데모 범위 밖이다(README·결정 로그
 * 명시). 커밋 전 크래시로 `processing`에 고아로 남는 job의 복구도 도메인 전이표 변경이 필요해 별도 승인 대상이다.
 */
export interface DeliveryLedger {
  /** @param key dedupe 키(기본: job.id). @returns 이미 전송된 키인지 여부. */
  wasDelivered(key: string): boolean;
  /** dedupe 키를 전송 완료로 표시한다. @param key dedupe 키 */
  markDelivered(key: string): void;
}

/**
 * job으로부터 dedupe 키를 파생한다. `job.id`는 재시도(`failed→pending`) 시에도 동일하므로 원장 기반 중복
 * 방지의 안정적 키가 된다(단, 전송 성공 후 실패 판정된 재시도의 중복까지 막지는 못한다 — at-least-once).
 * @param job 처리 대상 job
 * @returns dedupe 키
 */
export function deriveDeliveryKey(job: Job): string {
  return job.id;
}
