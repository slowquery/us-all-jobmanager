import { formatDigestMessage } from './digest-message';
import { DigestGroup } from './news-digest.ports';

describe('formatDigestMessage', () => {
  it('그룹이 여러 개면 헤더에 job 제목과 주제 개수를 포함한다', () => {
    const groups: DigestGroup[] = [
      {
        topic: '경제',
        summary: '금리 인상 이슈',
        headlines: ['헤드라인1'],
      },
      {
        topic: 'IT',
        summary: 'AI 발표',
        headlines: [
          '헤드라인2',
          '헤드라인3',
        ],
      },
    ];

    const text = formatDigestMessage('오늘의 뉴스', groups);

    expect(text.startsWith('📰 오늘의 뉴스 다이제스트 [오늘의 뉴스] — 주제 2개')).toBe(true);
  });

  it('각 그룹의 topic·summary·headlines를 순서대로 렌더링한다', () => {
    const groups: DigestGroup[] = [{
      topic: '경제',
      summary: '금리 인상 이슈',
      headlines: [
        '헤드라인1',
        '헤드라인2',
      ],
    }];

    const text = formatDigestMessage('오늘의 뉴스', groups);

    expect(text).toContain('*▸ 경제*');
    expect(text).toContain('  금리 인상 이슈');
    expect(text).toContain('   • 헤드라인1');
    expect(text).toContain('   • 헤드라인2');

    const topicIdx = text.indexOf('*▸ 경제*');
    const summaryIdx = text.indexOf('금리 인상 이슈');
    const headline1Idx = text.indexOf('헤드라인1');
    const headline2Idx = text.indexOf('헤드라인2');
    expect(topicIdx).toBeLessThan(summaryIdx);
    expect(summaryIdx).toBeLessThan(headline1Idx);
    expect(headline1Idx).toBeLessThan(headline2Idx);
  });

  it('summary가 빈 문자열이면 요약 줄을 생략하고 헤드라인만 렌더링한다', () => {
    const groups: DigestGroup[] = [{
      topic: '정치',
      summary: '',
      headlines: ['헤드라인A'],
    }];

    const text = formatDigestMessage('오늘의 뉴스', groups);

    expect(text).toContain('*▸ 정치*');
    expect(text).toContain('   • 헤드라인A');
    // 요약 줄(2칸 들여쓰기, 불릿 아님)이 없어야 한다.
    const lines = text.split('\n');
    const hasSummaryLine = lines.some((line) => line.startsWith('  ') && !line.startsWith('   •'));
    expect(hasSummaryLine).toBe(false);
  });

  it('summary가 공백만 있으면(trim 시 빈 문자열) 요약 줄을 생략한다', () => {
    const groups: DigestGroup[] = [{
      topic: '사회',
      summary: '   ',
      headlines: ['헤드라인B'],
    }];

    const text = formatDigestMessage('오늘의 뉴스', groups);

    const lines = text.split('\n');
    const hasSummaryLine = lines.some((line) => line.startsWith('  ') && !line.startsWith('   •'));
    expect(hasSummaryLine).toBe(false);
  });

  it('그룹들은 빈 줄로 구분된다', () => {
    const groups: DigestGroup[] = [
      {
        topic: '주제1',
        summary: '요약1',
        headlines: ['헤드라인1'],
      },
      {
        topic: '주제2',
        summary: '요약2',
        headlines: ['헤드라인2'],
      },
    ];

    const text = formatDigestMessage('타이틀', groups);
    const sections = text.split('\n\n');

    // 헤더 + 그룹1 + 그룹2 = 3 섹션
    expect(sections).toHaveLength(3);
    expect(sections[1]).toContain('주제1');
    expect(sections[2]).toContain('주제2');
  });

  it('빈 그룹 배열이면 헤더만 반환하고 주제 개수는 0이다', () => {
    const text = formatDigestMessage('타이틀', []);

    expect(text).toBe('📰 오늘의 뉴스 다이제스트 [타이틀] — 주제 0개');
  });

  it('헤드라인이 여러 개면 각각 별도의 불릿 줄로 렌더링한다', () => {
    const groups: DigestGroup[] = [{
      topic: '주제',
      summary: '요약',
      headlines: [
        'A',
        'B',
        'C',
      ],
    }];

    const text = formatDigestMessage('타이틀', groups);

    expect(text).toContain('   • A');
    expect(text).toContain('   • B');
    expect(text).toContain('   • C');
  });

  it('헤드라인이 빈 배열이면 불릿 줄 없이 topic·summary만 렌더링한다', () => {
    const groups: DigestGroup[] = [{
      topic: '주제',
      summary: '요약',
      headlines: [],
    }];

    const text = formatDigestMessage('타이틀', groups);

    expect(text).not.toContain('•');
    expect(text).toContain('*▸ 주제*');
    expect(text).toContain('  요약');
  });
});
