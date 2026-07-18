import { validate } from 'class-validator';
import { AtLeastOneField } from './at-least-one-field.validator';

@AtLeastOneField([
  'a',
  'b',
])
class Sample {
  a?: string;

  b?: string;
}

describe('AtLeastOneField', () => {
  it('지정 필드가 모두 undefined이면 검증에 실패한다', async () => {
    const errors = await validate(new Sample());
    expect(errors.some((error) => error.constraints?.atLeastOneField !== undefined)).toBe(true);
  });

  it('지정 필드 중 하나라도 값이 있으면 통과한다', async () => {
    const sample = new Sample();
    sample.b = 'present';
    const errors = await validate(sample);
    expect(errors).toHaveLength(0);
  });

  it('기본 메시지는 필드 목록을 포함한다', async () => {
    const errors = await validate(new Sample());
    const message = errors[0]?.constraints?.atLeastOneField;
    expect(message).toBe('a, b 중 최소 1개 필드가 필요합니다.');
  });
});
