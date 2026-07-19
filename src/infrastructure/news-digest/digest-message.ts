import { DigestGroup } from './news-digest.ports';

/**
 * 주제별 그룹 목록을 Slack 전송용 메시지(mrkdwn)로 포맷한다.
 *
 * 각 그룹을 "주제 → 요약 → 소속 헤드라인" 순으로 렌더링해, 가독성 있게 주제 단위로 묶인 다이제스트를
 * 만든다. 순수 함수(부수효과 없음)이므로 단위 테스트로 포맷을 결정론적으로 검증한다.
 *
 * @param jobTitle 다이제스트를 트리거한 job 제목(헤더 표기용)
 * @param groups 주제별 뉴스 그룹 목록
 * @returns Slack `text`로 보낼 mrkdwn 문자열
 */
export function formatDigestMessage(jobTitle: string, groups: DigestGroup[]): string {
  const header = `📰 오늘의 뉴스 다이제스트 [${jobTitle}] — 주제 ${groups.length}개`;
  const sections = groups.map((group) => {
    const lines: string[] = [`*▸ ${group.topic}*`];
    if (group.summary.trim().length > 0) {
      lines.push(`  ${group.summary.trim()}`);
    }
    for (const headline of group.headlines) {
      lines.push(`   • ${headline}`);
    }
    return lines.join('\n');
  });
  return [
    header,
    ...sections,
  ].join('\n\n');
}
