import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PatchJobDto } from './patch-job.dto';

describe('PatchJobDto', () => {
  it('세 필드 모두 선택이므로 빈 객체도 통과한다(최소 1개 필드 검증은 컨트롤러 책임)', async () => {
    const dto = plainToInstance(PatchJobDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("status:'pending'은 통과한다", async () => {
    const dto = plainToInstance(PatchJobDto, { status: 'pending' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each(['processing', 'completed', 'failed'])('status:%s는 검증에 실패한다', async (status) => {
    const dto = plainToInstance(PatchJobDto, { status });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });
});
