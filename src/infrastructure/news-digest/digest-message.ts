import { DigestGroup } from './news-digest.ports';

/**
 * Slack mrkdwn 제어문자를 이스케이프한다(Slack 규칙: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`).
 *
 * 뉴스 RSS·Gemini 응답은 신뢰할 수 없는 외부 콘텐츠이므로, `<!channel>`/`<!everyone>`(전체 멘션 스팸)나
 * `<url|text>`(링크 마스킹 피싱) 같은 mrkdwn 컨트롤 시퀀스가 그대로 채널에 방송되지 않도록 조립 전에
 * 반드시 이스케이프한다(간접 프롬프트 인젝션 방어).
 * @param text 이스케이프 대상 원문
 * @returns Slack에 안전한 문자열
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 주제별 그룹 목록을 Slack 전송용 메시지(mrkdwn)로 포맷한다.
 *
 * 각 그룹을 "주제 → 요약 → 소속 헤드라인" 순으로 렌더링해, 가독성 있게 주제 단위로 묶인 다이제스트를
 * 만든다. 외부 콘텐츠(주제·요약·헤드라인)는 {@link escapeMrkdwn}로 이스케이프한다. 순수 함수(부수효과
 * 없음)이므로 단위 테스트로 포맷을 결정론적으로 검증한다.
 *
 * @param jobTitle 다이제스트를 트리거한 job 제목(헤더 표기용)
 * @param groups 주제별 뉴스 그룹 목록
 * @returns Slack `text`로 보낼 mrkdwn 문자열
 */
export function formatDigestMessage(jobTitle: string, groups: DigestGroup[]): string {
  const header = `📰 오늘의 뉴스 다이제스트 [${escapeMrkdwn(jobTitle)}] — 주제 ${groups.length}개`;
  const sections = groups.map((group) => {
    const lines: string[] = [`*▸ ${escapeMrkdwn(group.topic)}*`];
    if (group.summary.trim().length > 0) {
      lines.push(`  ${escapeMrkdwn(group.summary.trim())}`);
    }
    for (const headline of group.headlines) {
      lines.push(`   • ${escapeMrkdwn(headline)}`);
    }
    return lines.join('\n');
  });
  return [
    header,
    ...sections,
  ].join('\n\n');
}
