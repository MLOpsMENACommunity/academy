import { courseInputSchema } from '@academy/shared';
import { seedCourses } from '../prisma/seed-data';

/** The seed's course content: valid for the admin form, complete in both languages, nothing left to fill in. */
describe('seed course content', () => {
  const k8s = seedCourses.find((s) => s.course.slug === 'kubernetes')!;
  const c = k8s.course;

  it('every seed course passes the admin course schema', () => {
    for (const s of seedCourses) {
      const r = courseInputSchema.safeParse({ ...s.course, instructorIds: [] });
      expect(
        r.success
          ? []
          : r.error.issues.map((i) => `${s.course.slug}: ${i.path.join('.')}: ${i.message}`),
      ).toEqual([]);
    }
  });

  it('Kubernetes: the owner content, in English and Arabic', () => {
    expect(c.titleEn).toBe('Kubernetes Mastery: From Containers to Production & AI Infrastructure');
    expect(c.titleAr).toMatch(/Kubernetes/);
    expect(c.outline).toHaveLength(23);
    for (const m of c.outline) {
      expect(m.titleAr.trim()).not.toBe('');
      expect(m.descriptionEn?.trim()).toBeTruthy();
      expect(m.descriptionAr?.trim()).toBeTruthy();
    }
    expect(c.learningOutcomes.en).toHaveLength(6);
    expect(c.learningOutcomes.ar).toHaveLength(6);
    expect(c.prerequisites.en).toHaveLength(7);
    expect(c.prerequisites.ar).toHaveLength(7);
    expect(c.targetAudience.en.split('\n')).toHaveLength(5);
    expect(c.targetAudience.ar.split('\n')).toHaveLength(5);
    // The about text carries labs, capstones, outcomes, what's different, tools and what comes next, in both languages.
    const headings = (md: string) => md.split('\n').filter((l) => l.startsWith('## '));
    expect(headings(c.longDescriptionEn)).toHaveLength(6);
    expect(headings(c.longDescriptionAr)).toHaveLength(6);
    for (const tool of ['Gateway API', 'Kueue', 'vLLM', 'Argo CD', 'Velero']) {
      expect(c.longDescriptionEn).toContain(tool);
      expect(c.longDescriptionAr).toContain(tool);
    }
  });

  it('Kubernetes: details not decided stay "to be announced", with the waiting list', () => {
    expect(c.status).toBe('COMING_SOON');
    expect(c.type).toBe('PAID');
    expect(c.price).toBe(0); // "Price to be announced", never "Free"
    expect([c.startDate, c.durationWeeks, c.hoursPerWeek, c.applicationDeadline]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(c.included).toMatchObject({
      liveSessions: false,
      certificate: false,
      notesEn: 'Will be announced soon.',
      notesAr: 'سيُعلَن عنه قريبًا.',
    });
    expect(k8s.placeholder).toBeFalsy();
    expect(k8s.supersedes?.length).toBeGreaterThan(0);
  });

  it('has no placeholders, blanks or third-party platform links', () => {
    const text = JSON.stringify(seedCourses);
    expect(text).not.toMatch(/\[PLACEHOLDER\]|zomra|_{3,}/i);
  });
});
