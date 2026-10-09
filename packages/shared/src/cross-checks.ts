import { z } from 'zod';

type AddIssue = (path: (string | number)[], message: string) => void;

/**
 * Runs `base` and `check` side by side and reports both sets of issues at once.
 * A plain `.superRefine` only runs once every field is valid, so a cross-field
 * error (e.g. a missing description, or ML/AI experience above the total) would
 * only appear on a second submit, after the other errors were fixed. `check`
 * sees the raw input.
 */
export function withCrossChecks<T extends z.ZodTypeAny>(
  base: T,
  check: (raw: Record<string, unknown>, addIssue: AddIssue) => void,
): z.ZodType<z.output<T>, z.ZodTypeDef, unknown> {
  return z.unknown().transform((raw, ctx) => {
    const parsed = base.safeParse(raw);
    let failed = !parsed.success;
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue(issue as z.IssueData);
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    check(input, (path, message) => {
      failed = true;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    });
    return failed ? z.NEVER : (parsed.data as z.output<T>);
  });
}
