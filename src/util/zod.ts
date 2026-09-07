export function validateInplace<T>(schema: z.ZodType<T>, data: unknown): T {
<<<<<<< HEAD
  const result = parsePrettified(schema, data ?? {});
  if (typeof data !== 'object' || data === null) {
    return result;
  }

=======
  const result = parsePrettified(schema, data);
>>>>>>> 1ca256efb083b39bc0e190b951d84e7eeb602823
  return _.assign(data, result) as T;
}

export function parsePrettified<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
