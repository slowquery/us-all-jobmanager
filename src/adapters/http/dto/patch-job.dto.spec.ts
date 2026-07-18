import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PatchJobDto } from './patch-job.dto';

describe('PatchJobDto', () => {
  it('빈 객체는 AtLeastOneField 검증에 실패한다(최소 1개 필드 필요)', async () => {
    const dto = plainToInstance(PatchJobDto, {});
    const errors = await validate(dto);
    expect(errors.some((error) => error.constraints?.atLeastOneField !== undefined)).toBe(true);
  });

  it('title 하나만 있어도 통과한다', async () => {
    const dto = plainToInstance(PatchJobDto, { title: 'x' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("status:'pending'은 통과한다", async () => {
    const dto = plainToInstance(PatchJobDto, { status: 'pending' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each([
    'processing',
    'completed',
    'failed',
  ])('status:%s는 검증에 실패한다', async (status) => {
    const dto = plainToInstance(PatchJobDto, { status });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });
});
