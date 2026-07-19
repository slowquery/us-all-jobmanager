import { DeliveryLedger } from './news-digest.ports';

/**
 * `DeliveryLedger`의 인프로세스 메모리 구현체.
 *
 * `Set<string>`으로 전송 완료 키를 보관한다 — 프로세스 재시작 시 원장이 비워지므로 재시작 후
 * 재처리는 at-least-once(중복 전송 가능)로 수용한다(README에 명시된 알려진 한계).
 */
export class InMemoryDeliveryLedger implements DeliveryLedger {
  private readonly delivered = new Set<string>();

  /**
   * @param key dedupe 키(기본: job.id)
   * @returns 이미 전송된 키인지 여부
   */
  wasDelivered(key: string): boolean {
    return this.delivered.has(key);
  }

  /**
   * dedupe 키를 전송 완료로 표시한다.
   * @param key dedupe 키
   */
  markDelivered(key: string): void {
    this.delivered.add(key);
  }
}
