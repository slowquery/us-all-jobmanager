import { DigestGroup, NewsArticle, NewsDigestBuilder } from './news-digest.ports';

/**
 * Gemini에 보낼 프롬프트를 구성한다. 기사(제목+스니펫)를 나열하고, 동일 주제끼리 묶어 각 그룹의
 * 주제 라벨·간단 요약·소속 헤드라인을 JSON 배열로 반환하도록 지시한다.
 * @param articles 그룹핑·요약 대상 기사
 * @returns Gemini generateContent 요청에 담을 프롬프트 텍스트
 */
function buildPrompt(articles: NewsArticle[]): string {
  const list = articles
    .map((a, i) => `${i + 1}. ${a.title}${a.snippet ? ` — ${a.snippet}` : ''}`)
    .join('\n');
  return [
    '다음은 오늘의 뉴스 기사 목록이다. 동일하거나 유사한 주제의 기사끼리 그룹으로 묶고,',
    '각 그룹마다 (1) 짧은 주제 라벨(topic), (2) 그룹을 관통하는 1~2문장 한국어 요약(summary),',
    '(3) 그 그룹에 속한 기사 제목 목록(headlines)을 만들어라.',
    '반드시 아래 형태의 JSON 배열로만 답하라(설명·마크다운 없이):',
    '[{"topic":"...","summary":"...","headlines":["...", "..."]}]',
    '',
    '기사 목록:',
    list,
  ].join('\n');
}

/** Gemini 응답 텍스트에서 코드펜스(```json ... ```)를 제거한다. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text.trim());
  return fenced ? fenced[1] : text.trim();
}

/** 임의 JSON 값을 {@link DigestGroup} 배열로 정규화한다(형식이 어긋난 항목은 걸러낸다). */
function coerceGroups(parsed: unknown): DigestGroup[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const groups: DigestGroup[] = [];
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const topic = typeof record.topic === 'string' ? record.topic.trim() : '';
    const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
    const headlines = Array.isArray(record.headlines)
      ? record.headlines.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).map((h) => h.trim())
      : [];
    if (topic.length === 0 && headlines.length === 0) continue;
    groups.push({
      topic: topic || '기타',
      summary,
      headlines,
    });
  }
  return groups;
}

/** Gemini `generateContent` 응답 중 이 구현체가 실제로 사용하는 최소 형태. */
interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * `NewsDigestBuilder`의 Gemini(Google Generative Language API) 구현체. 기사들을 주제별 그룹으로
 * 묶고 각 그룹을 요약한다. `responseMimeType: application/json`으로 구조화 JSON 출력을 강제해 파싱
 * 안정성을 높인다.
 */
export class GeminiNewsDigestBuilder implements NewsDigestBuilder {
  /**
   * @param apiKey Gemini API 키(비밀 값 — 하드코딩 금지, 호출부에서 환경변수로 주입)
   * @param model 사용할 모델명(예: `gemini-flash-lite-latest`)
   * @param fetchImpl 주입 가능한 fetch 구현체(테스트용 fake 대체, 기본값은 전역 fetch)
   */
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * 기사들을 주제별 그룹으로 묶고 각 그룹의 요약을 생성한다. 응답이 비정상(`!res.ok`)이거나 JSON
   * 파싱 결과 그룹이 비면 예외를 던져 상위 `NewsDigestJobProcessor`가 `{ outcome: 'failed' }`로
   * 매핑하도록 한다.
   * @param articles 그룹핑·요약 대상 기사
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  async buildGroupedDigest(articles: NewsArticle[], signal: AbortSignal): Promise<DigestGroup[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(articles) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 4096,
        },
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Gemini 다이제스트 생성 실패: HTTP ${res.status}`);
    }
    const body = (await res.json()) as GenerateContentResponse;
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new Error('Gemini 응답에 다이제스트 텍스트가 없음');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(text));
    } catch {
      throw new Error('Gemini 응답 JSON 파싱 실패');
    }
    const groups = coerceGroups(parsed);
    if (groups.length === 0) {
      throw new Error('Gemini 응답에서 유효한 그룹을 얻지 못함');
    }
    return groups;
  }
}
