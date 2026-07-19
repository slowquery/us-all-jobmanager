import { GeminiNewsDigestBuilder } from './gemini-news-digest-builder';
import { NewsArticle } from './news-digest.ports';

/** 테스트용 fake fetch 응답을 만든다. */
function fakeResponse(opts: { ok: boolean; status?: number; body?: unknown }): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: async () => opts.body ?? {},
  } as unknown as Response;
}

/** Gemini candidates 구조로 감싼 응답 본문을 만든다. */
function candidateBody(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const ARTICLES: NewsArticle[] = [
  {
    title: '첫 번째 헤드라인',
    snippet: '첫 번째 설명',
    link: 'https://example.com/1',
  },
  {
    title: '두 번째 헤드라인',
    snippet: '두 번째 설명',
    link: 'https://example.com/2',
  },
];

describe('GeminiNewsDigestBuilder', () => {
  it('JSON 배열 문자열 응답을 DigestGroup[]으로 파싱한다', async () => {
    const groups = [
      {
        topic: '경제',
        summary: '경제 관련 요약',
        headlines: ['첫 번째 헤드라인'],
      },
      {
        topic: '정치',
        summary: '정치 관련 요약',
        headlines: ['두 번째 헤드라인'],
      },
    ];
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify(groups)),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    const result = await builder.buildGroupedDigest(ARTICLES, new AbortController().signal);

    expect(result).toEqual(groups);
  });

  it('```json 코드펜스로 감싼 응답도 파싱한다', async () => {
    const groups = [{
      topic: '사회',
      summary: '사회 요약',
      headlines: ['첫 번째 헤드라인'],
    }];
    const fenced = `\`\`\`json\n${JSON.stringify(groups)}\n\`\`\``;
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(fenced),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    const result = await builder.buildGroupedDigest(ARTICLES, new AbortController().signal);

    expect(result).toEqual(groups);
  });

  it('요청 URL에 model을 포함하고, key는 x-goog-api-key 헤더로, body에 responseMimeType과 기사 제목을 담아 보낸다', async () => {
    const groups = [{
      topic: '경제',
      summary: '요약',
      headlines: ['첫 번째 헤드라인'],
    }];
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify(groups)),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('secret-key', 'gemini-flash-lite-latest', fetchImpl);
    const { signal } = new AbortController();

    await builder.buildGroupedDigest(ARTICLES, signal);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [
      url,
      init,
    ] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'secret-key',
    });
    expect(init.signal).toBe(signal);
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(parsedBody.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    expect(parsedBody.contents[0].parts[0].text).toContain('첫 번째 헤드라인');
    expect(parsedBody.contents[0].parts[0].text).toContain('두 번째 헤드라인');
  });

  it('HTTP 응답이 비정상이면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: false,
      status: 503,
    }));
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    await expect(builder.buildGroupedDigest(ARTICLES, new AbortController().signal)).rejects.toThrow();
  });

  it('응답에 다이제스트 텍스트가 없으면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: true,
      body: { candidates: [] },
    }));
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    await expect(builder.buildGroupedDigest(ARTICLES, new AbortController().signal)).rejects.toThrow();
  });

  it('JSON 파싱에 실패하면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody('이것은 JSON이 아님'),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    await expect(builder.buildGroupedDigest(ARTICLES, new AbortController().signal)).rejects.toThrow();
  });

  it('유효한 그룹이 0개면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify([])),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    await expect(builder.buildGroupedDigest(ARTICLES, new AbortController().signal)).rejects.toThrow();
  });

  it('topic이 비었지만 headlines가 있으면 "기타"로 대체하고, headlines의 비-string 값은 필터링한다', async () => {
    const raw = [{
      topic: '',
      summary: '요약',
      headlines: [
        '첫 번째 헤드라인',
        123,
        null,
        '  두 번째 헤드라인  ',
      ],
    }];
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify(raw)),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    const result = await builder.buildGroupedDigest(ARTICLES, new AbortController().signal);

    expect(result).toEqual([{
      topic: '기타',
      summary: '요약',
      headlines: [
        '첫 번째 헤드라인',
        '두 번째 헤드라인',
      ],
    }]);
  });

  it('topic도 headlines도 모두 비면 해당 항목을 제외한다', async () => {
    const raw = [
      {
        topic: '',
        summary: '무시될 요약',
        headlines: [],
      },
      {
        topic: '경제',
        summary: '유지될 요약',
        headlines: [],
      },
    ];
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify(raw)),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    const result = await builder.buildGroupedDigest(ARTICLES, new AbortController().signal);

    expect(result).toEqual([{
      topic: '경제',
      summary: '유지될 요약',
      headlines: [],
    }]);
  });

  it('파싱 결과가 배열이 아니면 유효 그룹 0개로 처리해 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        body: candidateBody(JSON.stringify({ not: 'an array' })),
      }),
    );
    const builder = new GeminiNewsDigestBuilder('api-key', 'gemini-flash-lite-latest', fetchImpl);

    await expect(builder.buildGroupedDigest(ARTICLES, new AbortController().signal)).rejects.toThrow();
  });
});
