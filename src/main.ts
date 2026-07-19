import 'reflect-metadata';
// .env 로드는 다른 어떤 코드보다 먼저 실행되어야 한다 — otel 부트스트랩과 NestFactory 모듈 배선
// (스케줄러의 JOB_PROCESSOR useFactory가 뉴스 다이제스트 env를 읽는 지점)이 이미 채워진
// process.env를 보게 하기 위함이다. dotenv/config는 import 시점에 즉시 .env를 로드한다.
import 'dotenv/config';
// otel.bootstrap은 나머지 import(특히 @opentelemetry/api를 사용하는 adapter 코드)보다 먼저
// 실행되어야 SDK가 글로벌 TracerProvider/ContextManager를 선점 등록한다(06-observability-design.md
// traceId 규약 ②: 상시 초기화가 정본). import 순서 자체가 부트스트랩 순서를 보장하는 지점이므로
// 이 파일 최상단에 위치해야 한다.

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
// eslint-disable-next-line import/order -- otel.bootstrap은 adapter 코드(@opentelemetry 사용)를
// 끌어오는 app.module보다 반드시 먼저 import되어야 한다(파일 상단 주석 참조). import/order의
// 알파벳 정렬(app < otel)보다 이 부트스트랩 순서 보장이 우선한다.
import { initializeOtel } from './otel.bootstrap';
import { AppModule } from './app.module';

initializeOtel();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 보안 헤더(최소 하드닝): 인증은 범위 외(수용 리스크)이므로, 미인증 관리자 표면의 잔여 위험을
  // 줄이기 위해 클릭재킹/MIME 스니핑/레퍼러 유출을 방지하는 안전한(SPA 비파괴) 헤더만 부여한다.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // 관리자 SPA(admin-ui Vite 빌드 산출물) 정적 서빙. dist/main.js 기준 상대 경로로 해석해
  // nest start·node dist/main.js·Docker 어디서든 <root>/public을 가리킨다(cwd 비의존).
  const publicDir = join(__dirname, '..', 'public');
  if (!existsSync(publicDir)) {
    Logger.warn(
      `public/ 를 ${publicDir} 에서 찾을 수 없습니다 — /admin/ 이 404됩니다 (\`yarn build:admin\` 실행 후 public/ 커밋).`,
      'Bootstrap',
    );
  }
  app.useStaticAssets(publicDir, { prefix: '/admin/' });

  // Swagger(OpenAPI) 문서. 요청/응답 example은 각 DTO의 @ApiProperty·컨트롤러의 @ApiResponse에
  // 선언돼 있다. /api-docs에서 Swagger UI, /api-docs-json에서 OpenAPI JSON을 제공한다.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('UsAllJobManager API')
    .setDescription('작업(Job) 관리 REST API — 요청/응답 example 포함')
    .setVersion(process.env.npm_package_version ?? '0.0.0')
    .addTag('jobs', '작업 CRUD·검색·재시도 전이')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`UsAllJobManager scheduler is running on port ${port}`, 'Bootstrap');
}

bootstrap();
