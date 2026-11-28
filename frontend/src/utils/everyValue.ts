/**
 * Every value of a union, checked by the compiler: once the union gains a
 * value, the list fails to type-check until a fixture covers it.
 */
export const everyValue =
  <T extends string>() =>
  <const V extends readonly T[]>(
    ...values: V &
      ([Exclude<T, V[number]>] extends [never]
        ? unknown
        : { missing: Exclude<T, V[number]> })
  ): V =>
    values;
