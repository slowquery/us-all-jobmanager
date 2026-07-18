import { LogEvent, LoggerPort } from '../ports/logger.port';

/**
 * 테스트 전용 인메모리 `LoggerPort` 더블. 기록된 이벤트를 배열로 누적해 assert에 사용한다.
 */
export class InMemoryLogger implements LoggerPort {
  readonly events: LogEvent[] = [];

  log(event: LogEvent): void {
    this.events.push(event);
  }
}
