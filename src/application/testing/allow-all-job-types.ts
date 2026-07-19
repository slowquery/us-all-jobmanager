import { SupportedJobTypes } from '../ports/supported-job-types.port';

/**
 * 테스트 전용 {@link SupportedJobTypes} 더블. 모든 작업 제목을 구현된 유형으로 취급해 생성 검증을
 * 우회한다 — 생성 검증 자체가 관심사가 아닌(전이·조회·동시성 등) 테스트가 임의 제목의 job을 그대로
 * 만들 수 있게 한다. 생성 검증(거부) 자체를 다루는 테스트는 대신 `AllowListJobTypes`를 주입한다.
 */
export class AllowAllJobTypes implements SupportedJobTypes {
  /**
   * 항상 구현된 유형으로 판정한다.
   * @returns 언제나 true
   */
  isSupported(): boolean {
    return true;
  }

  /** 허용 목록을 노출하지 않는다(전량 허용이므로 목록 개념이 없다). */
  get titles(): readonly string[] {
    return [];
  }
}
