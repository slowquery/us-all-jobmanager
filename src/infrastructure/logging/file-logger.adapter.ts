import { randomBytes } from 'crypto';
import { createWriteStream, WriteStream } from 'fs';
import { trace } from '@opentelemetry/api';
import { LogEvent, LoggerPort } from '../../application/ports/logger.port';

/** traceId/fallback 발급에 사용하는 바이트 수(16바이트 → 32-hex, 06 traceId 규약). */
const TRACE_ID_BYTES = 16;

/**
 * `LoggerPort`의 파일 기반 구현체. 05-logging-design.md가 확정한 단일 write stream·NDJSON
 * 포맷·traceId 규약을 실장한다.
 *
 * ### 단일 write stream
 * 호출마다 파일을 열고 닫지 않도록 `fs.createWriteStream(path, { flags: 'a' })`로 fd 하나를
 * 재사용한다(05 확정 #10, 성능 리뷰 권고). 이벤트 1건당 정확히 1회의 `stream.write()` 호출로 개행
 * 포함 NDJSON 한 줄을 기록한다(여러 write로 나누면 Node.js 단일 프로세스 내 write 시스템 콜의
 * 라인 단위 원자성 보장이 깨질 수 있다, 05 "파일 append의 동시 쓰기 안전성" 절).
 *
 * ### traceId/spanId (06 traceId 발급·전파 규약, 읽기 전용 예외)
 * 이 어댑터는 `trace.getActiveSpan()`으로 **읽기만** 한다 — 스팬을 새로 생성하지 않는다(계측은
 * adapter 2곳 — HTTP 인터셉터/스케줄러 어댑터 — 한정, 06 확정). active span이 있으면 그
 * `spanContext().traceId`(32-hex 소문자)를 정본으로 사용하고 `spanId`(16-hex 소문자)도 함께
 * 싣는다. active span이 없으면(OTel SDK 미초기화 등 예외 경로) `crypto.randomBytes(16)`로 동일
 * 형식(32-hex)의 fallback traceId를 매 로그 라인마다 새로 발급한다 — 이 fallback은 요청/tick 내
 * 상관(correlation)을 보장하지 못하며, 이는 정상 경로(active span 정본)를 대체하지 않는 예외
 * 경로의 명시적 한계다(06 "③ 미초기화 한계" 절). 이 fallback 경로에서는 spanId 필드 자체를
 * 생략한다(스팬이 없으므로 spanId도 존재하지 않는다).
 *
 * ### 로깅 실패 격리
 * `log()`는 절대 예외를 던지지 않는다 — 파일 I/O 실패, 스트림 오류, 직렬화 실패 등 어떤 이유로든
 * 로깅이 실패해도 호출자의 원 요청/처리 흐름에 영향을 주지 않는다(05 로깅 실패 격리 조항,
 * `LoggerPort.log` 계약).
 *
 * ### 요청 body 로깅 금지
 * 이 어댑터는 `LogEvent` 유니온이 정의한 필드만 직렬화한다. `LogEvent`에는애초 요청 body가 포함되지
 * 않으므로(05 확정 #11 보안 조항 ②), 이 클래스가 임의의 payload를 로그 라인에 흘리는 경로는
 * 존재하지 않는다.
 */
export class FileLoggerAdapter implements LoggerPort {
  private readonly stream: WriteStream;

  /**
   * @param logPath `logs.txt` append 대상 경로(테스트 격리를 위해 주입, 기본 `logs.txt`)
   */
  constructor(logPath = 'logs.txt') {
    this.stream = createWriteStream(logPath, { flags: 'a' });
    // 스트림 자체의 비동기 오류 이벤트가 처리되지 않으면 프로세스가 죽을 수 있어 무해화한다
    // (로깅 실패 격리 조항의 일부, write() 호출 시 동기 예외뿐 아니라 스트림 레벨 오류까지 포함).
    this.stream.on('error', () => {
      // 의도적으로 비움: 로깅 실패를 호출자에게 전파하지 않는다.
    });
  }

  log(event: LogEvent): void {
    try {
      const { traceId, spanId } = this.resolveTraceContext();
      const fields = Object.fromEntries(
        Object.entries(event).filter(([key]) => key !== 'type'),
      );
      const record: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        traceId,
        ...(spanId === undefined ? {} : { spanId }),
        ...fields,
      };
      this.stream.write(`${JSON.stringify(record)}\n`);
    } catch {
      // 의도적으로 비움: 로깅 실패는 호출자의 요청/처리 흐름에 전파되지 않는다.
    }
  }

  /**
   * active span의 트레이스 컨텍스트를 읽기 전용으로 조회한다(스팬 생성 없음). 스팬이 없으면
   * 동일 형식(32-hex)의 fallback traceId만 발급하고 spanId는 생략한다.
   */
  private resolveTraceContext(): { traceId: string; spanId?: string } {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (spanContext) {
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
      };
    }
    return { traceId: randomBytes(TRACE_ID_BYTES).toString('hex') };
  }
}
