export function validateInplace<T>(schema: z.ZodType<T>, data: unknown): T {
<<<<<<< HEAD
  const result = parsePrettified(schema, data ?? {});
  if (typeof data !== 'object' || data === null) {
    return result;
  }

=======
  const result = parsePrettified(schema, data);
>>>>>>> ef276773b7d94dbf5add0a84e36d55ee51298e17
  return _.assign(data, result) as T;
}

export function parsePrettified<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw Error(z.prettifyError(result.error));
  }
  return result.data;
}
