import 'reflect-metadata';
// otel.bootstrap은 나머지 import(특히 @opentelemetry/api를 사용하는 adapter 코드)보다 먼저
// 실행되어야 SDK가 글로벌 TracerProvider/ContextManager를 선점 등록한다(06-observability-design.md
// traceId 규약 ②: 상시 초기화가 정본). import 순서 자체가 부트스트랩 순서를 보장하는 지점이므로
// 이 파일 최상단에 위치해야 한다.

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { initializeOtel } from './otel.bootstrap';
import { AppModule } from './app.module';

initializeOtel();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
