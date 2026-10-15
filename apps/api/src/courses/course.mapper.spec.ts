import { NO_SEATS, toCourseDetail, toCourseSummary } from './course.mapper';

describe('public course mapper', () => {
  it('never exposes session links or the Drive folder', () => {
    const now = new Date();
    const course = {
      id: 'c1', slug: 'k', titleEn: 'K', titleAr: 'ك', shortDescriptionEn: '', shortDescriptionAr: '',
      longDescriptionEn: '', longDescriptionAr: '', type: 'PAID', price: 100, currency: 'EGP',
      requiresApproval: true, capacity: 10, status: 'OPEN', level: 'INTERMEDIATE', language: 'AR',
      startDate: now, applicationsOpenAt: null, applicationDeadline: null, durationWeeks: 6, hoursPerWeek: 5,
      coverImageUrl: null, targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' },
      learningOutcomes: { en: [], ar: [] }, prerequisites: { en: [], ar: [] }, outline: [], faq: [],
      included: {}, deliveryPlatform: 'GOOGLE_MEET', recordingsPlatform: 'GOOGLE_DRIVE',
      driveFolderUrl: 'https://drive.google.com/drive/folders/SECRET_FOLDER',
      youtubePlaylistUrl: null, createdAt: now, updatedAt: now, archivedAt: null,
      instructors: [],
      screeningQuestions: [],
      sessions: [
        {
          id: 's1', courseId: 'c1', order: 1, titleEn: 'S', titleAr: 'ج', descriptionEn: null, descriptionAr: null,
          startsAt: now, durationMin: 90, liveUrl: 'https://meet.google.com/SECRET-LIVE',
          recordingUrl: 'https://drive.google.com/file/SECRET-REC', materials: [{ url: 'https://x/SECRET-MAT' }],
          assignmentUrl: 'https://x/SECRET-ASSIGN', createdAt: now, updatedAt: now,
        },
      ],
    };
    const json = JSON.stringify(toCourseDetail(course as never, { taken: 3, enrolled: 2 }));
    expect(json).not.toMatch(/SECRET/);
    expect(json).toContain('"seatsRemaining":7');
  });

  it('shows recordings of ended lessons only when the course made them public', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const session = (id: string, startsAt: string) => ({
      id, courseId: 'c1', order: 1, titleEn: 'S', titleAr: 'ج', descriptionEn: null, descriptionAr: null, startsAt: new Date(startsAt),
      durationMin: 90, liveUrl: 'https://meet.google.com/SECRET-LIVE', recordingUrl: `https://www.youtube.com/watch?v=${id}`,
      materials: [], assignmentUrl: null, topics: ['docker'], createdAt: now, updatedAt: now,
    });
    const course = {
      id: 'c1', slug: 'k', titleEn: 'K', titleAr: 'ك', type: 'FREE', status: 'COMPLETED', publicRecordings: true, capacity: null, cohortNumber: 1,
      endDate: now, topics: [], targetAudience: { en: '', ar: '' }, notFor: { en: '', ar: '' }, outline: [], faq: [], included: {},
      instructors: [], screeningQuestions: [],
      sessions: [session('past1', '2026-09-01T16:00:00Z'), session('future1', '2026-10-09T11:30:00Z')],
      createdAt: now, updatedAt: now,
    };
    const dto = toCourseDetail(course as never, NO_SEATS, now);
    expect(dto.completed).toBe(true);
    expect(dto.sessions.map((s) => s.recordingUrl)).toEqual(['https://www.youtube.com/watch?v=past1', null]);
    expect(JSON.stringify(dto)).not.toMatch(/SECRET/);
    expect(toCourseDetail({ ...course, publicRecordings: false } as never, NO_SEATS, now).sessions.every((s) => s.recordingUrl === null)).toBe(true);
    // A paid course's recordings never go public, whatever the flag says.
    expect(toCourseDetail({ ...course, type: 'PAID' } as never, NO_SEATS, now).sessions.every((s) => s.recordingUrl === null)).toBe(true);
  });

  it('shows the enrolled count (the number only) unless the course hides it, and seats left only while open', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const course = {
      id: 'c1', slug: 'k', titleEn: 'K', titleAr: 'ك', type: 'FREE', status: 'OPEN', capacity: 10, showEnrolledCount: true,
      applicationsOpenAt: null, applicationDeadline: null, instructors: [], createdAt: now, updatedAt: now,
    };
    const open = toCourseSummary(course as never, { taken: 7, enrolled: 5 }, now);
    expect(open).toMatchObject({ enrolledCount: 5, seatsLeft: 3, seatsRemaining: 3 });
    // Full: 0 seats left ("Course full"), never negative.
    expect(toCourseSummary(course as never, { taken: 12, enrolled: 12 }, now).seatsLeft).toBe(0);
    // Hidden by the admin: null, while the seats still show.
    expect(toCourseSummary({ ...course, showEnrolledCount: false } as never, { taken: 7, enrolled: 5 }, now)).toMatchObject({ enrolledCount: null, seatsLeft: 3 });
    // Not open for applications (closed, a past cohort) or no capacity: no seats left to show.
    const closed = { ...course, applicationDeadline: new Date('2026-10-01T00:00:00Z') };
    expect(toCourseSummary(closed as never, { taken: 1, enrolled: 1 }, now).seatsLeft).toBeNull();
    expect(toCourseSummary({ ...course, status: 'COMPLETED' } as never, { taken: 1, enrolled: 1 }, now).seatsLeft).toBeNull();
    expect(toCourseSummary({ ...course, capacity: null } as never, { taken: 1, enrolled: 1 }, now)).toMatchObject({ seatsLeft: null, enrolledCount: 1 });
  });
});
