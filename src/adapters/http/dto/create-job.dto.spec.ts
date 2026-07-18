import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDto } from './create-job.dto';

describe('CreateJobDto', () => {
  it('title/description이 유효하면 검증을 통과한다', async () => {
    const dto = plainToInstance(CreateJobDto, {
      title: 'Task',
      description: 'Do something',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('description 없이도 통과한다(선택 필드)', async () => {
    const dto = plainToInstance(CreateJobDto, { title: 'Task' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('title이 없으면 검증에 실패한다', async () => {
    const dto = plainToInstance(CreateJobDto, { description: 'no title' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });

  it('title이 200자를 초과하면 검증에 실패한다', async () => {
    const dto = plainToInstance(CreateJobDto, { title: 'a'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });
});
