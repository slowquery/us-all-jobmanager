// 모든 시각을 KST(Asia/Seoul)로 표기한다. 백엔드는 ISO8601(UTC)을 반환하므로
// 브라우저 로컬 타임존과 무관하게 항상 한국 시간으로 렌더링한다.
const KST_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** ISO8601 문자열을 `YYYY. MM. DD. HH:mm:ss KST` 형태로 변환한다(파싱 실패 시 원본 반환). */
export function formatKst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${KST_FORMATTER.format(date)} KST`;
}
