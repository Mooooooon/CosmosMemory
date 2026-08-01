<<<<<<< HEAD
import type {
  LiteralUnion as TypeFestLiteralUnion,
  PartialDeep as TypeFestPartialDeep,
  PartialDeepOptions as TypeFestPartialDeepOptions,
  Primitive as TypeFestPrimitive,
  SetRequired as TypeFestSetRequired,
} from 'type-fest';

declare global {
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
>>>>>>> 594877de3d6ea4230111d3f97f6ef22c7409b0c6
