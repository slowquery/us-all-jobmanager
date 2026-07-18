import { Module } from '@nestjs/common';
import { HttpModule } from './adapters/http/http.module';
import { SchedulerModule } from './adapters/scheduler/scheduler.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

/**
 * 애플리케이션 루트 모듈. 배선 세부는 관심사별 모듈로 분리하고, 여기서는 조합만 담당한다(Rule 3,
 * 유지보수성):
 * - {@link InfrastructureModule}: 포트 구현체(로거/저장소/프로세서)를 토큰에 바인딩·export(공유).
 * - {@link HttpModule}: API 엔드포인트(컨트롤러·HTTP 유스케이스·전역 pipe/filter/interceptor).
 * - {@link SchedulerModule}: 60초 tick 스케줄러·처리 유스케이스.
 *
 * HTTP·스케줄러가 `InfrastructureModule`을 각자 import하므로 포트 인스턴스는 앱 전역에서 공유되고,
 * e2e 테스트의 `.overrideProvider(LOGGER_PORT|JOB_REPOSITORY)`는 export된 토큰을 통해 그대로 동작한다.
 */
@Module({
  imports: [
    InfrastructureModule,
    HttpModule,
    SchedulerModule,
  ],
})
export class AppModule {}
