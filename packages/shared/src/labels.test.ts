import { describe, expect, it } from 'vitest';
import { courseAvailabilityLabels, courseAvailabilityText, selfPacedOpenLabel } from './labels';

describe('courseAvailabilityText', () => {
  it('says "Start any time" for an open self-paced course, in both languages', () => {
    expect(courseAvailabilityText({ availability: 'OPEN', selfPaced: true }, 'en')).toBe('Start any time');
    expect(courseAvailabilityText({ availability: 'OPEN', selfPaced: true }, 'ar')).toBe(selfPacedOpenLabel.ar);
  });

  it('keeps the usual label for a live course, and for a self-paced course that is not open', () => {
    expect(courseAvailabilityText({ availability: 'OPEN', selfPaced: false }, 'en')).toBe(courseAvailabilityLabels.OPEN.en);
    expect(courseAvailabilityText({ availability: 'OPEN' }, 'ar')).toBe(courseAvailabilityLabels.OPEN.ar);
    expect(courseAvailabilityText({ availability: 'CLOSED', selfPaced: true }, 'en')).toBe(courseAvailabilityLabels.CLOSED.en);
    expect(courseAvailabilityText({ availability: 'UPCOMING', selfPaced: true }, 'ar')).toBe(courseAvailabilityLabels.UPCOMING.ar);
  });
});
