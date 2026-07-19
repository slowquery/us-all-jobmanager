/**
 * "실제로 구현된 작업 유형"의 레지스트리 포트.
 *
 * 이 앱의 스케줄러는 `pending` job을 선점해 처리하지만, 실제 처리 로직이 구현된 작업 유형은
 * 제한적이다(현재는 뉴스 다이제스트 하나뿐이며 나머지는 기본 처리기가 무동작으로 성공 처리한다).
 * `POST /jobs`가 구현되지 않은 작업을 그대로 받아들이면 "아무 일도 하지 않고 성공"하는 job이
 * 생기므로, 생성 시점에 구현 여부를 검증하기 위한 seam이다.
 *
 * 구현 유형 집합은 배선(설정)마다 다르므로 application 계층은 이 포트에만 의존하고 구체 목록은
 * 주입받는다(Rule 3, 헥사고날 경계). 이 검증은 안전 경계(입력 검증)에 해당하므로 어떤 경우에도
 * 축소하지 않는다.
 */
export interface SupportedJobTypes {
  /**
   * 주어진 작업 제목이 실제 구현된 작업 유형인지 판정한다.
   * @param title 생성 요청의 작업 제목
   * @returns 구현된 유형이면 true
   */
  isSupported(title: string): boolean;

  /** 현재 배선에서 구현된 작업 유형(제목) 목록. 오류 메시지·문서화에 쓴다. */
  readonly titles: readonly string[];
}

/**
 * 허용 목록(구현된 제목 집합) 기반 {@link SupportedJobTypes} 구현체.
 *
 * 운영 배선은 스케줄러가 실제 라우팅하는 유형(예: 뉴스 다이제스트 sentinel 제목)으로 구성하고,
 * 테스트는 자체 목록을 주입해 격리한다. 제목 비교는 앞뒤 공백을 제거한 정확 일치다.
 */
export class AllowListJobTypes implements SupportedJobTypes {
  private readonly allow: ReadonlySet<string>;

  /**
   * @param titles 구현된 작업 유형(제목) 목록. 빈 값·공백은 제외한다.
   */
  constructor(titles: readonly string[]) {
    this.allow = new Set(titles.map((t) => t.trim()).filter((t) => t.length > 0));
  }

  /**
   * 제목이 허용 목록에 있는지 판정한다.
   * @param title 검사할 작업 제목
   * @returns 허용 목록에 있으면 true
   */
  isSupported(title: string): boolean {
    return this.allow.has(title.trim());
  }

  /** 허용 목록에 등록된 구현 유형(제목) 배열. */
  get titles(): readonly string[] {
    return [...this.allow];
  }
}
