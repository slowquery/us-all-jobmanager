import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchQueryDto } from './search-query.dto';

describe('SearchQueryDto', () => {
  it('title만 있어도 통과한다', async () => {
    const dto = plainToInstance(SearchQueryDto, { title: 'deploy' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('빈 객체는 AtLeastOneField 검증에 실패한다(title/status 최소 1개)', async () => {
    const dto = plainToInstance(SearchQueryDto, {});
    const errors = await validate(dto);
    expect(errors.some((error) => error.constraints?.atLeastOneField !== undefined)).toBe(true);
  });

  it('title이 200자를 초과하면 검증에 실패한다', async () => {
    const dto = plainToInstance(SearchQueryDto, { title: 'x'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });

  it.each([
    'pending',
    'processing',
    'completed',
    'failed',
  ])('status:%s는 통과한다', async (status) => {
    const dto = plainToInstance(SearchQueryDto, { status });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('허용되지 않는 status 값은 검증에 실패한다', async () => {
    const dto = plainToInstance(SearchQueryDto, { status: 'bogus' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });
});
