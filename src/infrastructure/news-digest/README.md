# news-digest

"뉴스 다이제스트" job을 실제로 처리하는 infrastructure 어댑터 모음이다. `application`/`domain`
계층은 여기 구현체를 알지 못하며, `news-digest.ports.ts`에 정의된 seam(`NewsSource` /
`NewsDigestBuilder` / `SlackNotifier` / `DeliveryLedger`)에만 의존한다(Rule 3).

기능: 오늘의 뉴스 기사를 가져와 **동일 주제끼리 그룹으로 묶고 각 그룹을 요약**한 뒤, 주제별로 정리한
다이제스트를 Slack으로 전송한다.

## 처리 흐름

```
NewsDigestJobProcessor.process(job)
  1. key = deriveDeliveryKey(job)                    // 기본: job.id
  2. ledger.wasDelivered(key)?
       yes -> { outcome: 'completed' }                // idempotent skip, 협력자 호출 없음
  3. AbortController + setTimeout(timeoutMs)로 파이프라인 전체 timeout 설정
  4. [span news.fetch]     newsSource.fetchTodayArticles(signal)   // NewsArticle[]; 빈 배열이면 오류
  5. [span news.summarize] builder.buildGroupedDigest(articles, signal) // DigestGroup[]; 빈 그룹이면 오류
  6. text = formatDigestMessage(job.title, groups)   // 주제 → 요약 → 헤드라인 (Slack mrkdwn, 이스케이프)
  7. [span news.notify]    notifier.notify(text, signal)
  8. ledger.markDelivered(key)
  9. logger.log({ type:'digest', outcome:'completed', digestDurationMs, articleCount, groupCount, model })
 10. { outcome: 'completed' }

  4~8 중 어디서든 오류(예외·timeout·비정상 응답) 발생 시:
    logger.log({ type:'digest', outcome:'failed', digestDurationMs, articleCount, groupCount, model })
    logger.log({ type:'error', level:'error', source:'scheduler',
                 message:'news digest failed for job <id>', errorCode:'NEWS_DIGEST_FAILED' })
    { outcome: 'failed' }   // 절대 throw하지 않는다(JobProcessor no-throw 계약)
```

## 구현체

- `HttpNewsSource` — RSS 피드(`fetchImpl` 주입 가능, 기본 전역 `fetch`)에서 `<item>`의 title/link/description을
  파싱해 `NewsArticle{ title, snippet, link }` 배열을 만든다(snippet은 HTML 태그·CDATA·엔티티 제거 후 최대 200자).
  HTTP 비정상 응답은 예외를 던진다(processor가 failed로 매핑).
- `GeminiNewsDigestBuilder` — Gemini `generateContent`를 호출해 기사들을 **주제별 그룹 + 그룹 요약**으로 묶는다
  (`generationConfig.responseMimeType: application/json`으로 구조화 JSON 강제, `maxOutputTokens`로 절단 방지,
  응답 parts 전체 concat 후 코드펜스 제거·`coerceGroups`로 정규화). 응답 이상/빈 텍스트/파싱 실패/빈 그룹은 예외.
- `WebhookSlackNotifier` — Slack Incoming Webhook에 `{ text }` JSON을 POST한다.
- `InMemoryDeliveryLedger` — `Set<string>` 기반 인프로세스 dedupe 원장.
- `digest-message.ts` (`formatDigestMessage`) — `DigestGroup[]`을 "주제 → 요약 → 헤드라인" Slack mrkdwn으로
  렌더링한다. 외부(RSS/Gemini) 콘텐츠는 `&`/`<`/`>`를 이스케이프해 `<!channel>` 멘션 스팸·`<url|text>` 링크
  마스킹(간접 프롬프트 인젝션)을 차단한다.

## 관측성

- **Tempo**: `news.fetch`/`news.summarize`/`news.notify` 자식 스팬(속성 `news.article_count`/`news.group_count`/
  `news.model`) — 단계별 실행시간. `@opentelemetry/api`는 infra 계층에서만 사용(FileLoggerAdapter 선례와 정합,
  application/domain 무침투). SDK 미초기화 시 `withSpan`은 no-op.
- **Loki**: 처리 1건마다 `DigestLogEvent`(`digestDurationMs`·`outcome`·`articleCount`·`groupCount`·`model`)를 남긴다.
  Grafana `news-digest` 대시보드가 이를 소스로 실행시간·처리속도·성공률을 집계한다.

## 알려진 한계

- **no-throw**: `NewsDigestJobProcessor`는 협력자의 모든 예외를 catch해 `{ outcome: 'failed' }`로 변환한다. 배치
  처리 중 한 job의 실패가 다른 job을 `processing`에 고착시키지 않기 위한 계약이다.
- **timeout**: 파이프라인 전체(수집→그룹핑→알림)에 단일 `timeoutMs`를 부과하는 `AbortController`를 사용한다.
  각 협력자는 이 `AbortSignal`에 협조해야 한다(동기 파싱·JSON.parse는 timeout이 끊지 못하는 한계 있음).
- **dedupe(at-least-once)**: `InMemoryDeliveryLedger`는 인프로세스 메모리이므로 프로세스 재시작 시 원장이 비워진다.
  전송 성공 후 실패 판정된 재시도, 또는 재시작 이후 재처리는 중복 전송이 가능하다(at-least-once 수용). 커밋 전
  크래시로 `processing`에 고아로 남는 job의 복구는 도메인 전이표 변경이 필요해 이 모듈의 범위 밖이다.

## 등록/호출

`NewsDigestJobProcessor`는 전역 단일 `JOB_PROCESSOR` 바인딩을 무조건 대체하지 않는다. **제목이
`config.jobTitle` sentinel(기본 `news-digest`)과 일치하는 job만** 이 처리기로 보내고 나머지는 기존
`DefaultJobProcessor`로 보내는 라우팅은 `DispatchingJobProcessor`(`application/ports/job-processor.strategy.ts`)가
담당한다. 기능이 활성화되면 `title = "news-digest"` job이 외부 Gemini/Slack 호출을 트리거하므로 그 제목은 사실상
예약된다. 실제 의존성 배선(어떤 `NewsSource`/`NewsDigestBuilder`/`SlackNotifier`/timeout/model을 쓸지, 비밀을
어디서 읽을지)은 이 디렉토리가 아니라 `scheduler.module`의 `job-processor.factory`가 담당한다 — 이 모듈은 순수
구현체만 제공한다.
