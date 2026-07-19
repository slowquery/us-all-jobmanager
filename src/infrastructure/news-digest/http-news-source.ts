import { NewsArticle, NewsSource } from './news-digest.ports';

/** RSS `<item>...</item>` 블록을 추출하는 정규식(비탐욕적, 멀티라인 대응). */
const ITEM_REGEX = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

/** `<item>` 블록 안의 `<title>...</title>` 텍스트를 추출하는 정규식. */
const TITLE_REGEX = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

/** `<item>` 블록 안의 `<link>...</link>` 텍스트를 추출하는 정규식. */
const LINK_REGEX = /<link\b[^>]*>([\s\S]*?)<\/link>/i;

/** `<item>` 블록 안의 `<description>...</description>` 텍스트를 추출하는 정규식. */
const DESCRIPTION_REGEX = /<description\b[^>]*>([\s\S]*?)<\/description>/i;

/** description 스니펫 최대 길이(과도한 프롬프트 방지). */
const MAX_SNIPPET_LENGTH = 200;

/** RSS/XML에서 흔히 쓰이는 HTML 엔티티 → 실제 문자 매핑. */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
  '&quot;': '"',
};

/**
 * 텍스트에 포함된 알려진 HTML 엔티티를 디코드한다.
 * @param text 디코드 대상 텍스트
 * @returns 디코드된 텍스트
 */
function decodeEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;|&#39;|&quot;/g, (matched) => HTML_ENTITIES[matched] ?? matched);
}

/** `<![CDATA[ ... ]]>` 래퍼를 제거한다(일부 RSS 피드는 제목/설명을 CDATA로 감싼다). */
function stripCdata(text: string): string {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  return match ? match[1] : text;
}

/** HTML 태그를 제거해 평문만 남긴다(구글 뉴스 description은 링크·목록 HTML을 포함). */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `<item>` 블록에서 특정 태그 텍스트를 뽑아 CDATA 제거·엔티티 디코드·trim 한다. */
function extractTag(itemXml: string, regex: RegExp): string {
  const match = regex.exec(itemXml);
  if (!match) {
    return '';
  }
  return decodeEntities(stripCdata(match[1]).trim());
}

/**
 * `NewsSource`의 HTTP(RSS) 구현체. 구글 뉴스 등 표준 RSS 2.0 피드의 `<channel><item>`에서
 * 제목·링크·설명 스니펫을 추출해 {@link NewsArticle} 목록으로 반환한다(피드 최상위 `<channel><title>`은
 * item 범위 밖이라 자동 제외됨). 요약·그룹핑은 하지 않고 원자료만 제공한다(단일 책임).
 */
export class HttpNewsSource implements NewsSource {
  /**
   * @param feedUrl 조회할 RSS 피드 URL
   * @param maxArticles 반환할 최대 기사 개수
   * @param fetchImpl 주입 가능한 fetch 구현체(테스트용 fake 대체, 기본값은 전역 fetch)
   */
  constructor(
    private readonly feedUrl: string,
    private readonly maxArticles: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * 오늘의 기사 목록(제목+스니펫+링크)을 반환한다. HTTP 응답이 비정상(`!res.ok`)이면 예외를 던져
   * 상위 `NewsDigestJobProcessor`가 `{ outcome: 'failed' }`로 매핑하도록 한다.
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  async fetchTodayArticles(signal: AbortSignal): Promise<NewsArticle[]> {
    const res = await this.fetchImpl(this.feedUrl, { signal });
    if (!res.ok) {
      throw new Error(`뉴스 피드 조회 실패: HTTP ${res.status}`);
    }
    const xml = await res.text();
    const articles: NewsArticle[] = [];
    for (const match of xml.matchAll(ITEM_REGEX)) {
      if (articles.length >= this.maxArticles) break;
      const itemXml = match[1];
      const title = extractTag(itemXml, TITLE_REGEX);
      if (title.length === 0) continue;
      const link = extractTag(itemXml, LINK_REGEX);
      const snippet = stripTags(extractTag(itemXml, DESCRIPTION_REGEX)).slice(0, MAX_SNIPPET_LENGTH);
      articles.push({
        title,
        snippet,
        link,
      });
    }
    return articles.slice(0, this.maxArticles);
  }
}
