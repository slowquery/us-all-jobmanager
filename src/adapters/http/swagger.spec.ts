import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { JOB_REPOSITORY, LOGGER_PORT } from '../tokens';
import { InMemoryJobRepository } from '../../application/testing/in-memory-job-repository';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';

describe('Swagger(OpenAPI) 문서', () => {
  let app: INestApplication;
  // 테스트 단언 편의를 위해 OpenAPI 문서를 느슨한 형태로 접근한다(union 타입 우회).
  let doc: OpenAPIObject;
  type Content = { content: Record<string, { example?: unknown; examples?: Record<string, unknown> }> };
  type Op = { requestBody?: Content; responses: Record<string, Content> };
  type LooseDoc = {
    paths: Record<string, Record<string, Op>>;
    components: { schemas: Record<string, { properties: Record<string, { example?: unknown }> }> };
  };
  const at = (): LooseDoc => doc as unknown as LooseDoc;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_PORT)
      .useValue(new InMemoryLogger())
      .overrideProvider(JOB_REPOSITORY)
      .useValue(new InMemoryJobRepository())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').setVersion('1').build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('5개 엔드포인트 경로를 모두 문서화한다', () => {
    const { paths } = at();
    expect(Object.keys(paths).sort()).toEqual([
      '/jobs',
      '/jobs/search',
      '/jobs/{id}',
    ]);
    expect(paths['/jobs'].post).toBeDefined();
    expect(paths['/jobs'].get).toBeDefined();
    expect(paths['/jobs/search'].get).toBeDefined();
    expect(paths['/jobs/{id}'].get).toBeDefined();
    expect(paths['/jobs/{id}'].patch).toBeDefined();
  });

  it('POST /jobs 요청 바디 example을 노출한다', () => {
    const examples = at().paths['/jobs'].post.requestBody?.content['application/json'].examples;
    expect(Object.keys(examples ?? {})).toContain('기본');
  });

  it('POST /jobs 201 응답 example을 노출한다', () => {
    const example = at().paths['/jobs'].post.responses['201'].content['application/json'].example;
    expect(example).toMatchObject({
      status: 'pending',
      title: expect.any(String),
    });
  });

  it('PATCH /jobs/{id} 409 에러 example을 노출한다', () => {
    const example = at().paths['/jobs/{id}'].patch.responses['409'].content['application/json'].example;
    expect(example).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('JobResponseDto 스키마 프로퍼티에 example이 있다', () => {
    expect(at().components.schemas.JobResponseDto.properties.title.example).toBe('배포 파이프라인 실행');
  });

  it('PatchJobDto 스키마는 실제 필드(title/description/status)만 노출한다', () => {
    expect(Object.keys(at().components.schemas.PatchJobDto.properties).sort()).toEqual([
      'description',
      'status',
      'title',
    ]);
  });
});
