import { toCourseDetail } from './course.mapper';

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
    const json = JSON.stringify(toCourseDetail(course as never, 3));
    expect(json).not.toMatch(/SECRET/);
    expect(json).toContain('"seatsRemaining":7');
  });
});
