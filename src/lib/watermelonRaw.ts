/**
 * WatermelonDB `_RawRecord` typings omit timestamp columns; sync and writes set them explicitly.
 */
export function wmRaw(model: { _raw: unknown }): Record<string, number> {
  return model._raw as unknown as Record<string, number>
}
