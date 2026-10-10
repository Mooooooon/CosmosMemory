<<<<<<< HEAD
import type {
  LiteralUnion as TypeFestLiteralUnion,
  PartialDeep as TypeFestPartialDeep,
  PartialDeepOptions as TypeFestPartialDeepOptions,
  Primitive as TypeFestPrimitive,
  SetRequired as TypeFestSetRequired,
} from 'type-fest';

declare global {
  // 酒馆源码中的 toastr.options 赋值会推断出不完整的同名命名空间，
  // 显式采用 @types/toastr 的完整 API，同时声明浏览器全局属性。
  const toastr: typeof import('toastr');
  interface Window {
    toastr: typeof import('toastr');
  }

  namespace TypeFest {
    export type LiteralUnion<LiteralType, BaseType extends TypeFestPrimitive = string> = TypeFestLiteralUnion<
      LiteralType,
      BaseType
    >;
    export type PartialDeep<
      T,
      Options extends TypeFestPartialDeepOptions = TypeFestPartialDeepOptions,
    > = TypeFestPartialDeep<T, Options>;
    export type SetRequired<BaseType, Keys extends keyof BaseType> = TypeFestSetRequired<BaseType, Keys>;
  }
}

export {};
=======
declare const hljs: typeof import('highlight.js').default;
declare const Popper: typeof import('@popperjs/core');
>>>>>>> 4af016ef3c8d031ba403a25fc9f3e26fc4c3e5b3
