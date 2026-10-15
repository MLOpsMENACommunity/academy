/**
 * Whether the quiz player should submit by itself: once, when time is up, and only after the
 * answers saved in this browser have been restored. On a reload during the grace period after
 * the time limit, the countdown is already at zero on the first render: submitting then would
 * send an empty attempt instead of the student's answers.
 */
export function shouldAutoSubmit(s: { remaining: number | null; restored: boolean; submitted: boolean; tried: boolean }): boolean {
  return s.restored && s.remaining !== null && s.remaining <= 0 && !s.submitted && !s.tried;
}
