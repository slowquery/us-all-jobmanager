import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * 클래스 레벨 검증: 지정한 필드 중 **최소 1개**가 `undefined`가 아니어야 통과한다. PATCH·검색처럼
 * "모든 필드가 선택이지만 전부 비어 있으면 안 되는" 규칙을 컨트롤러 `if` 분기 대신 DTO에 응집시켜
 * class-validator/ValidationPipe 공통 파이프라인으로 일원화하기 위한 커스텀 데코레이터다.
 *
 * 클래스에 부착하되, 데코레이터를 실제로 붙일 프로퍼티는 아무거나 하나면 된다(검증은 대상 객체
 * 전체를 보므로). 관례상 첫 번째 후보 필드에 부착한다.
 *
 * @param fields 최소 1개는 존재해야 하는 프로퍼티 이름 목록
 * @param validationOptions class-validator 표준 옵션(메시지 등)
 */
export function AtLeastOneField(
  fields: string[],
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'atLeastOneField',
      target: target.constructor,
      propertyName: propertyName.toString(),
      constraints: [fields],
      // always:true — 동일 프로퍼티의 @IsOptional이 값 부재 시 검증을 건너뛰지 못하게 강제한다
      // (빈 객체에서도 이 클래스 레벨 규칙이 반드시 평가되어야 하므로).
      options: {
        ...validationOptions,
        always: true,
      },
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const [names] = args.constraints as [string[]];
          const object = args.object as Record<string, unknown>;
          return names.some((name) => object[name] !== undefined);
        },
        defaultMessage(args: ValidationArguments): string {
          const [names] = args.constraints as [string[]];
          return `${names.join(', ')} 중 최소 1개 필드가 필요합니다.`;
        },
      },
    });
  };
}
