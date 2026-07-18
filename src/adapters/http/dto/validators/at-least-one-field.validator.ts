import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * **클래스 데코레이터**: 지정한 필드 중 최소 1개가 `undefined`가 아니어야 통과한다. PATCH·검색처럼
 * "모든 필드가 선택이지만 전부 비어 있으면 안 되는" 규칙을 컨트롤러 `if` 분기 대신 DTO에 응집시켜
 * class-validator/ValidationPipe 공통 파이프라인으로 일원화한다.
 *
 * 클래스에 직접 부착하므로 **합성 프로퍼티가 필요 없다** — 프로퍼티 데코레이터로 구현하면 그
 * 프로퍼티가 화이트리스트에 포함되어 `forbidNonWhitelisted`가 동명 키를 거부하지 못하는 문제가
 * 있었으나, 클래스 레벨 등록은 스키마에 프로퍼티를 추가하지 않아 여분 키가 정상적으로 거부된다.
 * 또한 `@IsOptional`이 붙은 실제 필드에 얹혔을 때 값 부재 시 검증이 통째로 건너뛰어지던 문제도
 * 발생하지 않는다.
 *
 * @param fields 최소 1개는 존재해야 하는 프로퍼티 이름 목록
 * @param validationOptions class-validator 표준 옵션(메시지 등)
 */
export function AtLeastOneField(
  fields: string[],
  validationOptions?: ValidationOptions,
): ClassDecorator {
  return (target: object): void => {
    registerDecorator({
      name: 'atLeastOneField',
      // 클래스 데코레이터의 target은 생성자 함수 자체다.
      target: target as new (...args: unknown[]) => object,
      // 클래스 레벨 등록(특정 프로퍼티에 매이지 않음). class-validator는 propertyName이 빈 문자열이면
      // 대상 객체 전체를 보는 클래스 제약으로 취급한다.
      propertyName: undefined as unknown as string,
      constraints: [fields],
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
