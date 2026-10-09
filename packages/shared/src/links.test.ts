import { describe, expect, it } from 'vitest';
import { instructorInputSchema } from './admin';
import { linkedinProfileUrlSchema, normalizeLinkedinUrl } from './links';

describe('LinkedIn profile links (instructors and speakers)', () => {
  it('strips tracking parameters and fragments, keeping the profile path', () => {
    expect(normalizeLinkedinUrl('https://www.linkedin.com/in/rashaddism?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=ios_app')).toBe(
      'https://www.linkedin.com/in/rashaddism',
    );
    expect(normalizeLinkedinUrl('  https://www.linkedin.com/in/sameh-amin/?trk=x#about ')).toBe('https://www.linkedin.com/in/sameh-amin/');
    expect(normalizeLinkedinUrl('https://WWW.LinkedIn.com/in/omar-khalil-10om01')).toBe('https://www.linkedin.com/in/omar-khalil-10om01');
    expect(normalizeLinkedinUrl('https://eg.linkedin.com/in/x')).toBe('https://eg.linkedin.com/in/x');
  });

  it('accepts only https linkedin.com profile links, as the student profile does', () => {
    for (const bad of [
      'http://www.linkedin.com/in/x',
      'https://u:p@www.linkedin.com/in/x',
      'https://www.linkedin.com',
      'https://www.linkedin.com/',
      'https://www.linkedin.com/?utm_source=x',
      'https://linkedin.com.evil.io/in/x',
      'https://evil.io/linkedin.com/in/x',
      'https://www.linkedin.com:8443/in/x',
      'https://github.com/x',
      'javascript:alert(1)',
      'www.linkedin.com/in/x',
    ]) {
      expect(normalizeLinkedinUrl(bad), bad).toBeNull();
    }
  });

  it('is required for an instructor or speaker, and stored normalised', () => {
    const base = { name: 'Mahmoud Sharif' };
    expect(instructorInputSchema.safeParse(base).success).toBe(false);
    expect(instructorInputSchema.safeParse({ ...base, linkedinUrl: '' }).success).toBe(false);
    expect(instructorInputSchema.safeParse({ ...base, linkedinUrl: 'https://github.com/x' }).success).toBe(false);
    const ok = instructorInputSchema.parse({ ...base, linkedinUrl: 'https://www.linkedin.com/in/mahmoud-sharif-mossad?utm_source=share' });
    expect(ok.linkedinUrl).toBe('https://www.linkedin.com/in/mahmoud-sharif-mossad');
    // No title or bio yet (photos and bios come later): name and LinkedIn are enough.
    expect(ok.titleEn).toBe('');
    expect(ok.bioEn).toBe('');
  });

  it('says which field is wrong, in words the admin form translates', () => {
    const r = linkedinProfileUrlSchema.safeParse('https://example.com/in/x');
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toContain('linkedin.com');
  });
});
