<<<<<<< HEAD
import type {
  LiteralUnion as TypeFestLiteralUnion,
  PartialDeep as TypeFestPartialDeep,
  PartialDeepOptions as TypeFestPartialDeepOptions,
  Primitive as TypeFestPrimitive,
  SetRequired as TypeFestSetRequired,
} from 'type-fest';

declare global {
  const hljs: typeof import('highlight.js').default;
  const Popper: typeof import('@popperjs/core');

  namespace TypeFest {
    export type LiteralUnion<LiteralType, BaseType extends TypeFestPrimitive = string> = TypeFestLiteralUnion<
      LiteralType,
      BaseType
    >;
    export type PartialDeep<T, Options extends TypeFestPartialDeepOptions = TypeFestPartialDeepOptions> = TypeFestPartialDeep<
      T,
      Options
    >;
    export type SetRequired<BaseType, Keys extends keyof BaseType> = TypeFestSetRequired<BaseType, Keys>;
  }
}

export {};
=======
declare const hljs: typeof import('highlight.js').default;
declare const Popper: typeof import('@popperjs/core');
>>>>>>> 4629787aab19c87872ec58696864de663d9ee38c
