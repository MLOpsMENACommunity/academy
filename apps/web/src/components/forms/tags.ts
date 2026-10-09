/** Adds a tag unless it is blank, too long, a case-insensitive duplicate, or over the limit. */
export function addTag(
  value: string[],
  raw: string,
  { max = 30, maxLength = 40 }: { max?: number; maxLength?: number } = {},
): { next: string[]; rejected: 'duplicate' | 'tooLong' | 'full' | null; tag: string } {
  const tag = raw.trim();
  if (!tag) return { next: value, rejected: null, tag };
  if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) return { next: value, rejected: 'duplicate', tag };
  if (tag.length > maxLength) return { next: value, rejected: 'tooLong', tag };
  if (value.length >= max) return { next: value, rejected: 'full', tag };
  return { next: [...value, tag], rejected: null, tag };
}
