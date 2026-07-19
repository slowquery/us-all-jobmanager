import { HttpNewsSource } from './http-news-source';

/** 테스트용 fake fetch 응답을 만든다. */
function fakeResponse(opts: { ok: boolean; status?: number; text?: string }): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    text: async () => opts.text ?? '',
  } as unknown as Response;
}

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>최상위 피드 제목</title>
    <item>
      <title>첫 번째 헤드라인 &amp; 속보</title>
      <link>https://example.com/1</link>
      <description><p>첫 번째 <b>설명</b> 내용</p></description>
    </item>
    <item>
      <title><![CDATA[두 번째 헤드라인]]></title>
      <link>https://example.com/2</link>
      <description><![CDATA[<p>두 번째 설명 &amp; 상세</p>]]></description>
    </item>
    <item>
      <title></title>
      <link>https://example.com/skip</link>
      <description>제목 없는 기사라 스킵되어야 함</description>
    </item>
    <item>
      <title>네 번째 헤드라인 &#39;따옴표&#39; &quot;겹따옴표&quot;</title>
    </item>
  </channel>
</rss>`;

describe('HttpNewsSource', () => {
  it('item 범위에서 title/snippet/link를 파싱하고 channel 최상위 title은 제외한다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: SAMPLE_RSS,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles).toEqual([
      {
        title: '첫 번째 헤드라인 & 속보',
        snippet: '첫 번째 설명 내용',
        link: 'https://example.com/1',
      },
      {
        title: '두 번째 헤드라인',
        snippet: '두 번째 설명 & 상세',
        link: 'https://example.com/2',
      },
      {
        title: '네 번째 헤드라인 \'따옴표\' "겹따옴표"',
        snippet: '',
        link: '',
      },
    ]);
  });

  it('title이 빈 item은 스킵한다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: SAMPLE_RSS,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles.some((a) => a.link === 'https://example.com/skip')).toBe(false);
  });

  it('description의 CDATA 래핑과 HTML 태그, 엔티티를 처리해 snippet을 만든다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: SAMPLE_RSS,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles[1]).toEqual({
      title: '두 번째 헤드라인',
      snippet: '두 번째 설명 & 상세',
      link: 'https://example.com/2',
    });
  });

  it('snippet은 최대 200자로 절단된다', async () => {
    const longDescription = 'ㄱ'.repeat(250);
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: `<rss><channel><item><title>긴 설명 기사</title><description>${longDescription}</description></item></channel></rss>`,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles).toHaveLength(1);
    expect(articles[0].snippet).toHaveLength(200);
    expect(articles[0].snippet).toBe('ㄱ'.repeat(200));
  });

  it('maxArticles로 반환 개수를 절단한다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: SAMPLE_RSS,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 2, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles).toHaveLength(2);
    expect(articles.map((a) => a.title)).toEqual([
      '첫 번째 헤드라인 & 속보',
      '두 번째 헤드라인',
    ]);
  });

  it('item이 없으면 빈 배열을 반환한다', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(fakeResponse({
        ok: true,
        text: '<rss><channel><title>빈 피드</title></channel></rss>',
      }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    const articles = await source.fetchTodayArticles(new AbortController().signal);

    expect(articles).toEqual([]);
  });

  it('HTTP 응답이 비정상이면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: false,
      status: 503,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);

    await expect(source.fetchTodayArticles(new AbortController().signal)).rejects.toThrow();
  });

  it('signal을 fetch에 전달한다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      text: SAMPLE_RSS,
    }));
    const source = new HttpNewsSource('https://feed.example.com/rss', 10, fetchImpl);
    const { signal } = new AbortController();

    await source.fetchTodayArticles(signal);

    expect(fetchImpl).toHaveBeenCalledWith('https://feed.example.com/rss', { signal });
  });
});
