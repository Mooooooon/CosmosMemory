export function validateInplace<T>(schema: z.ZodType<T>, data: unknown): T {
<<<<<<< HEAD
  const result = parsePrettified(schema, data ?? {});
  if (typeof data !== 'object' || data === null) {
    return result;
  }

=======
  const result = parsePrettified(schema, data);
>>>>>>> 1056dca462a9bece07f703a0a785c149ae580beb
  return _.assign(data, result) as T;
}

export function parsePrettified<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
