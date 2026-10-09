import { expect, test } from '@playwright/test';
import { latestEmail } from './support';

/**
 * "Notify me" on a course that isn't open: a visitor joins with an email, gets a
 * confirmation, and leaves through the link in it.
 */
test('visitor joins the waiting list and leaves through the email link', async ({ page, request }) => {
  const courses = (await (await request.get('/api/courses')).json()) as { slug: string; availability: string }[];
  const course = courses.find((c) => c.availability !== 'OPEN');
  test.skip(!course, 'No public course that is closed or coming soon');
  const email = `e2e-waitlist-${Date.now()}@example.test`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/courses/${course!.slug}`);
  // On phones the CTA is the bar pinned to the bottom.
  const bar = page.locator('div.sticky.bottom-0');
  await bar.getByRole('textbox').fill(email);
  await bar.getByRole('button', { name: 'Notify me' }).click();
  await expect(bar.getByText("You're on the waiting list")).toBeVisible();

  const html = await latestEmail(request, email);
  // The leave link is printed in the note and the footer of every waiting-list email.
  const link = /https?:\/\/[^\s"<]+\/waitlist\/leave\?token=[\w-]+\.[\w-]+/.exec(html)?.[0];
  expect(link, 'leave link in the confirmation').toBeTruthy();
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByRole('button', { name: 'Leave the list' }).click();
  await expect(page.getByText(/You've left the waiting list/)).toBeVisible();
});
