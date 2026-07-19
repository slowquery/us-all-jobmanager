# news-digest

"뉴스 다이제스트" job을 실제로 처리하는 infrastructure 어댑터 모음이다. `application`/`domain`
계층은 여기 구현체를 알지 못하며, `news-digest.ports.ts`에 정의된 seam(`NewsSource` /
`KeywordSummarizer` / `SlackNotifier` / `DeliveryLedger`)에만 의존한다(Rule 3).

## 처리 흐름

```
NewsDigestJobProcessor.process(job)
  1. key = deriveDeliveryKey(job)                 // 기본: job.id
  2. ledger.wasDelivered(key)?
       yes -> { outcome: 'completed' }             // idempotent skip, 협력자 호출 없음
  3. AbortController + setTimeout(timeoutMs)로 timeout 설정
  4. newsSource.fetchTodayHeadlines(signal)         // 빈 배열이면 오류로 취급
  5. summarizer.summarizeKeywords(headlines, signal)
  6. notifier.notify(text, signal)                  // text에 job.title + 키워드 포함
  7. ledger.markDelivered(key)
  8. { outcome: 'completed' }

  1~7 중 어디서든 오류 발생 시:
    logger?.log({ type:'error', level:'error', source:'scheduler',
                   message:'news digest failed for job <id>', errorCode:'NEWS_DIGEST_FAILED' })
    { outcome: 'failed' }   // 절대 throw하지 않는다(JobProcessor no-throw 계약)
```

## 구현체

- `HttpNewsSource` — RSS 피드(`fetchImpl` 주입 가능, 기본 전역 `fetch`)에서 `<item><title>`을
  파싱해 헤드라인 문자열 배열을 만든다. HTTP 비정상 응답은 예외를 던진다(processor가 failed로 매핑).
- `GeminiKeywordSummarizer` — Gemini `generateContent` API를 호출해 헤드라인들을 키워드 배열로
  요약한다. 응답 이상/빈 텍스트는 예외를 던진다.
- `WebhookSlackNotifier` — Slack Incoming Webhook에 `{ text }` JSON을 POST한다.
- `InMemoryDeliveryLedger` — `Set<string>` 기반 인프로세스 dedupe 원장.

## 알려진 한계

- **no-throw**: `NewsDigestJobProcessor`는 협력자의 모든 예외를 catch해 `{ outcome: 'failed' }`로
  변환한다. 배치 처리 중 한 job의 실패가 다른 job을 `processing`에 고착시키지 않기 위한 계약이다
  (`JobProcessor` 인터페이스 문서 참조).
- **timeout**: 파이프라인 전체(수집→요약→알림)에 단일 `timeoutMs`를 부과하는 `AbortController`를
  사용한다. 각 협력자는 이 `AbortSignal`에 협조해야 한다.
- **dedupe(at-least-once)**: `InMemoryDeliveryLedger`는 인프로세스 메모리이므로 프로세스가
  재시작되면 원장이 비워진다. 재시작 이후 동일 job이 재처리되면 이미 전송된 내용이 다시
  전송될 수 있다(at-least-once, 중복 전송 가능). 커밋 전 크래시로 `processing`에 고아로 남는
  job의 복구는 도메인 전이표 변경이 필요해 이 모듈의 범위 밖이다.

## 등록/호출

`NewsDigestJobProcessor`는 전역 단일 `JOB_PROCESSOR` 바인딩을 그대로 대체하지 않는다. 뉴스 job만
이 처리기로 보내고 나머지는 기존 처리기로 보내는 라우팅은 `DispatchingJobProcessor`
(`application/ports/job-processor.strategy.ts`)가 job 제목 등의 술어(sentinel)로 판정한다. 실제
의존성 배선(어떤 `NewsSource`/`KeywordSummarizer`/`SlackNotifier`/timeout 값을 쓸지, API 키를
어디서 읽을지)은 이 디렉토리가 아니라 `scheduler.module`의 책임이다 — 이 모듈은 순수 구현체만
제공한다.
