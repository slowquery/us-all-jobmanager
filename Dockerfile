# syntax=docker/dockerfile:1
#
# 멀티스테이지 빌드: deps(설치 전용) → build(컴파일) → runtime(실행 전용, node:24-slim).
# 06-observability-design.md/09-final-design.md가 확정한 스택(NestJS + Yarn Berry,
# node-modules linker)을 그대로 따른다. 이 Dockerfile은 기존 소스/빌드 스크립트(package.json의
# `build`/`start:prod`)와 더불어, 커밋된 admin-ui 빌드 산출물(public/)을 정적 서빙용으로 소비한다.

# ---- deps: 의존성 설치 전용 (레이어 캐시 극대화) ----
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install --immutable

# ---- build: TypeScript 컴파일 (nest build → dist/) ----
FROM deps AS build
COPY . .
RUN yarn build

# ---- runtime: 실행 전용, dist만 구동 ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# 커밋된 admin-ui 빌드 산출물(public/)을 정적 서빙용으로 복사한다. build 스테이지의 COPY . . 에
# public/이 포함되므로 별도 프론트엔드 빌드 스테이지 없이 그대로 가져온다(main.ts가
# join(__dirname,'..','public')로 참조 — /app/dist/main.js → /app/public). WORKDIR /app 상태에서 복사.
COPY --from=build /app/public ./public

# logs.txt/jobs.json은 애플리케이션이 process.cwd() 기준 상대 경로로 쓴다(app.module.ts
# `new FileLoggerAdapter('logs.txt')`, `new JsonDbJobRepository('jobs.json', ...)`).
# 이미지 코드(/app/dist, /app/node_modules)와 런타임 쓰기 대상을 분리하기 위해 별도의 작업
#디렉터리(/app/run)를 컨테이너 cwd로 사용한다 — observability/docker-compose.yml이 이 경로를
# app-logs 볼륨으로 마운트해 Alloy와 로그 파일을 공유한다.
RUN mkdir -p /app/run
WORKDIR /app/run

EXPOSE 3000

CMD ["node", "/app/dist/main.js"]
