# Rule 3 — 헥사고날 / 클린 아키텍처

## 요약
`domain → application(+ports) → adapters → infrastructure`, 의존성은 안쪽으로만. 도메인/유스케이스에 `@nestjs/*` 금지, 경계는 포트(인터페이스)로 넘는다.

## 강제
어드바이저리(설계 리뷰어 확인). 후속 하드닝: `eslint-plugin-boundaries`/`dependency-cruiser`.

## 정규
[.gjc/rules/20-architecture-hexagonal.md](../../.gjc/rules/20-architecture-hexagonal.md)
