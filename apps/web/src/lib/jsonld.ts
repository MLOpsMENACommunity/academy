/** Serialises JSON-LD safely for a <script> tag (admin text can't close the tag). */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}
