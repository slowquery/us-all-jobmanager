import 'reflect-metadata';
// otel.bootstrap은 나머지 import(특히 @opentelemetry/api를 사용하는 adapter 코드)보다 먼저
// 실행되어야 SDK가 글로벌 TracerProvider/ContextManager를 선점 등록한다(06-observability-design.md
// traceId 규약 ②: 상시 초기화가 정본). import 순서 자체가 부트스트랩 순서를 보장하는 지점이므로
// 이 파일 최상단에 위치해야 한다.
import { initializeOtel } from './otel.bootstrap';

initializeOtel();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`UsAllJobManager scheduler is running on port ${port}`, 'Bootstrap');
}

bootstrap();
