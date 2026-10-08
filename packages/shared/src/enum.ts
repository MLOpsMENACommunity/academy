/**
 * Builds a frozen `{ VALUE: 'VALUE' }` object from a tuple so enums can be used
 * both as values (`Role.ADMIN`) and as union types (`Role`), and the tuple feeds
 * `z.enum(...)` directly. The Prisma schema declares the same values; a test in
 * apps/api keeps the two in sync.
 */
export function defineEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v, v]))) as {
    readonly [K in T[number]]: K;
  };
}
