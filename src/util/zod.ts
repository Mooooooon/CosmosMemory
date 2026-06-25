export function validateInplace<T>(schema: z.ZodType<T>, data: unknown): T {
<<<<<<< HEAD
  const result = parsePrettified(schema, data ?? {});
  if (typeof data !== 'object' || data === null) {
    return result;
  }

=======
  const result = parsePrettified(schema, data);
>>>>>>> 8fe4c8b17747e5ac913ad3f678108133d96630e3
  return _.assign(data, result) as T;
}

export function parsePrettified<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
