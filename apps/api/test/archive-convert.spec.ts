import { readArchive } from '../prisma/import-archive';
import { convertWebsite, type WebsiteInput } from '../prisma/archive-convert';
import { archiveFileSchema, parseArchive } from '../prisma/archive-schema';

/** A small slice of the community website's data, shaped like the real files. */
function website(over: Partial<WebsiteInput> = {}): WebsiteInput {
  const week = (n: number, title: string, lessons: string[] = [`Lesson ${n}a`, `Lesson ${n}b`], extra = {}) => ({ week: n, title, lessons, ...extra });
  return {
    sessions: [
      {
        slug: 'docker-deep-dive',
        title: 'Docker Deep Dive',
        subtitle: 'Docker: Building the Foundation for MLOps — Day 1',
        speaker: 'Mahmoud Sharif',
        speakerRole: 'Instructor · 3+ years experience',
        startsAt: '2026-08-22T20:00:00+03:00',
        topics: ['Virtualization vs containerization', 'Docker architecture', 'Images & containers', 'Networking', 'Storage & volumes', 'Writing a Dockerfile', 'Security', 'Docker Compose'],
        registerUrl: 'https://zomra.io/free-sessions/abc',
        note: 'No prerequisites — no prior Docker or Kubernetes required.',
        youtubeId: 'AFcoKDtyhec',
      },
      {
        slug: 'mlops-practitioner-3-inference-serving',
        title: 'The MLOps Practitioner — Session 3',
        subtitle: 'Inference, Serving & Release Strategies',
        speaker: 'Aya Nasser Salama',
        speakerRole: 'Founder',
        startsAt: '2026-09-06T19:00:00+03:00',
        durationMinutes: 90,
        topics: ['Orchestration with Apache Airflow', 'Why inference patterns matter', 'Three inference patterns', 'What model serving is', 'FastAPI', 'BentoML', 'TensorRT + Triton', 'ONNX Runtime + OpenVINO', 'vLLM', 'Load testing with Locust', 'Release strategies'],
      },
      {
        slug: 'brand-new-talk',
        title: 'A Brand New Talk',
        subtitle: 'Something nobody curated yet',
        speaker: 'New Person',
        speakerRole: 'Engineer',
        startsAt: '2027-01-10T19:00:00+02:00',
        topics: [],
      },
    ],
    course: {
      slug: 'mlops-practitioner',
      title: 'The MLOps Practitioner',
      dates: { start: '2026-08-15', end: '2026-10-02' },
      enrollUrl: 'https://zomra.io/courses/the-mlops-practitioner',
      repoUrl: 'https://github.com/MLOpsMENACommunity/mlops_practitioner_course',
      summary: 'From notebook to production.',
      instructor: { name: 'Aya Nasser Salama', role: 'Founder of MLOps MENA Community and Senior MLOps Engineer' },
      objectives: ['Objective'],
      includes: ['Certificate of completion'],
      resources: [{ label: 'Course repository', href: 'https://github.com/MLOpsMENACommunity/mlops_practitioner_course' }],
      outline: [
        week(1, 'From Notebook to Production-Ready Code', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], { project: 'An API.' }),
        week(2, 'MLOps Core', ['a', 'b', 'c', 'd', 'e', 'f'], { project: 'A pipeline.' }),
        week(3, '1st half of the project', [], { note: 'No lecture.' }),
        week(4, 'Inference, Serving & Release Strategies'),
        week(5, 'Model Optimization'),
        week(6, 'Observability'),
        week(7, 'Final project', [], { note: 'Ship it.' }),
      ],
      requirements: ['Python'],
      description: { hook: 'Hook.', body: ['Body.'], learnIntro: 'You will:', learn: ['Learn'], outro: 'Outro.' },
      audience: ['ML engineers'],
    },
    upcomingCourses: [{ slug: 'llmops', title: 'LLMOps', summary: 'Serving, evaluating, and operating LLM systems in production.', topics: ['vLLM'] }],
    team: [{ name: 'Aya Nasser Salama', role: 'Founder', photo: '/team/aya.jpg', bio: 'Senior MLOps engineer.', linkedin: 'https://www.linkedin.com/in/ayanasser/' }],
    youtube: {
      videos: [
        { id: 'AFcoKDtyhec', title: 'handson docker mlops mena community', published: '2026-08-24T12:34:27.000Z' },
        { id: 'Gnro52bcUsg', title: 'MLOps #3 | Model Serving at Scale', published: '2026-09-06T16:09:59.000Z' },
        { id: 'cScwFf5q36Q', title: 'From DevOps To MLOps', published: '2026-10-04T20:56:49.000Z' },
        { id: 'asIGEjkUQCI', title: 'Hands on FastAPI and backend For MLOps', published: '2026-09-13T14:19:37.000Z' },
        { id: '43MGkzT5bYQ', title: 'Kubernetes Deployment Strategies Explained Part 1', published: '2026-09-09T19:52:35.000Z' },
        { id: 'Zz_unknown1', title: 'Some Future Video!', published: '2026-11-01T10:00:00.000Z' },
      ],
    },
    youtubeMeta: { AFcoKDtyhec: { lengthSeconds: 10897 }, Gnro52bcUsg: { lengthSeconds: '9387' } },
    publicFiles: ['/speakers/aya-nasser-salama.webp'],
    ...over,
  };
}

describe('archive converter', () => {
  const file = archiveFileSchema.parse(convertWebsite(website()));

  it('turns website sessions into past live sessions with their recording, speaker and Arabic', () => {
    const docker = file.sessions.find((s) => s.slug === 'docker-deep-dive')!;
    expect(docker).toMatchObject({
      titleEn: 'Docker Deep Dive',
      titleAr: 'تعمّق في Docker',
      speaker: 'mahmoud-sharif',
      // The owner's list (7:00 PM Cairo) corrects the website's 20:00.
      startsAt: '2026-08-22T19:00:00+03:00',
      // The recording's length (3 h 1 min 37 s), rounded up to 5 minutes.
      durationMin: 185,
      recordingUrl: 'https://www.youtube.com/watch?v=AFcoKDtyhec',
      topics: ['docker', 'mlops'],
    });
    // The owner's "why / what you'll learn / requirements" replace the website's topic list.
    expect(docker.descriptionEn).toContain("### What you'll learn\n\n- Virtualization vs containerization, and Docker architecture.");
    expect(docker.descriptionEn).toContain('### Why attend');
    expect(docker.descriptionEn).toContain('### Requirements');
    expect(docker.descriptionAr).toContain('### ما ستتعلمه\n\n- المحاكاة الافتراضية مقابل الحاويات، ومعمارية Docker.');
    expect(docker.descriptionAr).toContain('### المتطلبات');
    // Hosts and guests become speakers too.
    expect(docker.coSpeakers).toEqual([
      { speaker: 'aya-nasser-salama', role: 'HOST' },
      { speaker: 'mariam-qotob', role: 'GUEST' },
    ]);
    // No links to the platform it was first hosted on, and no registration counts.
    expect(docker.descriptionEn).not.toContain('zomra');
    expect(JSON.stringify(file)).not.toMatch(/zomra|registered/i);
  });

  it("adds the owner's past sessions and corrects dates and descriptions", () => {
    const llm = file.sessions.find((s) => s.slug === 'introduction-to-llm-inference-engines')!;
    expect(llm).toMatchObject({
      titleEn: 'Introduction to LLM Inference Engines',
      speaker: 'mohamed-rashad',
      coSpeakers: [{ speaker: 'aya-nasser-salama', role: 'HOST' }],
      startsAt: '2026-10-08T20:00:00+03:00',
      durationMin: 90,
    });
    expect(llm.recordingUrl).toBeUndefined();
    expect(llm.titleAr).not.toBe('');
    expect(llm.descriptionAr).toContain('### ما ستتعلمه');
    // V1: the FastAPI session was on Saturday 12 Sep, 16:00 UTC (not its upload day).
    expect(new Date(file.sessions.find((s) => s.slug === 'hands-on-fastapi-backend-for-mlops')!.startsAt).toISOString()).toBe('2026-09-12T16:00:00.000Z');
    // L2: A/B routing is Part 2; Part 1 is Recreate, Rolling Update and Blue-Green.
    const part1 = file.sessions.find((s) => s.slug === 'kubernetes-deployment-strategies-part-1')!;
    expect(part1.descriptionEn).toMatch(/Recreate, Rolling Update and Blue-Green\./);
    // A/B is only mentioned as coming in Part 2.
    expect(part1.descriptionEn.split('Canary')[0]).not.toMatch(/A\/B/);
    expect(part1.descriptionEn).toContain('Canary, A/B routing and shadow traffic follow in Part 2.');
    expect(part1.descriptionAr.split('Canary')[0]).not.toMatch(/A\/B/);
  });

  it('gives speakers short factual roles and Arabic names, and nothing made up', () => {
    const byslug = (slug: string) => file.speakers.find((s) => s.slug === slug)!;
    expect(byslug('mahmoud-sharif')).toMatchObject({ nameAr: 'محمود شريف', titleEn: 'Instructor with eYouth and Mindset', bioEn: '3+ years instructing with eYouth and Mindset.' });
    expect(byslug('mohamed-rashad')).toMatchObject({ nameAr: 'محمد رشاد', titleEn: 'Co-Founder and CTO, DevisionX' });
    expect(byslug('mohamed-rashad').bioEn).toContain("Meta's Engineering Blog");
    expect(byslug('mariam-qotob')).toMatchObject({ titleEn: 'AI Engineer', nameAr: 'مريم قطب' });
    // No role in the owner's list: no title rather than a placeholder.
    expect(byslug('mohamed-samy')).toMatchObject({ titleEn: '', bioEn: '' });
  });

  it('keeps a session that is a course lesson out of the live sessions', () => {
    expect(file.sessions.map((s) => s.slug)).not.toContain('mlops-practitioner-3-inference-serving');
    const course = file.courses.find((c) => c.slug === 'mlops-practitioner')!;
    expect(course.sessions[2]).toMatchObject({
      titleEn: 'Inference, Serving & Release Strategies',
      recordingUrl: 'https://www.youtube.com/watch?v=Gnro52bcUsg',
      durationMin: 160,
    });
    // Lesson 3's topics come from the website's session entry, in English and Arabic.
    expect(course.sessions[2]!.descriptionEn).toContain('• Load testing with Locust');
    expect(course.sessions[2]!.descriptionAr).toContain('• اختبار الحِمل باستخدام Locust');
  });

  it('imports the course as a completed cohort with its instructor and syllabus, without the external platform', () => {
    const course = file.courses.find((c) => c.slug === 'mlops-practitioner')!;
    expect(course).toMatchObject({
      status: 'COMPLETED',
      cohortNumber: 1,
      // L3: the lessons ran 16 Aug – 20 Sep (the website said 15 Aug – 2 Oct).
      startDate: '2026-08-16',
      endDate: '2026-09-20',
      publicRecordings: true,
      instructors: ['aya-nasser-salama'],
    });
    expect(course).not.toHaveProperty('externalPlatform');
    expect(JSON.stringify(course)).not.toContain('zomra');
    expect(course.outline).toHaveLength(7);
    expect(course.outline[2]).toMatchObject({ titleAr: 'النصف الأول من المشروع (تنفيذ ومراجعة)', descriptionEn: 'No lecture.' });
    // L3: Observability was taught before Optimization.
    expect(course.outline.map((m) => m.titleEn).slice(4, 6)).toEqual(['Observability', 'Model Optimization']);
    // L3: lesson 5 has no recording, so the page doesn't claim every lesson is recorded.
    expect(course.shortDescriptionEn).not.toMatch(/every lesson/i);
    expect(course.longDescriptionEn).toContain('lesson 5 (Model Optimization, 20 September) has no public recording');
    expect(course.sessions.map((s) => s.recordingUrl ?? null)).toEqual([
      'https://www.youtube.com/watch?v=rJFIn83w0Dc',
      'https://www.youtube.com/watch?v=slxkWpCAqI8',
      'https://www.youtube.com/watch?v=Gnro52bcUsg',
      'https://www.youtube.com/watch?v=g79F3WLZKSQ',
      null,
    ]);
  });

  it('creates each speaker once, with the team bio and photo when they are on the team', () => {
    expect(file.speakers.map((s) => s.slug).sort()).toEqual([
      'aya-nasser-salama',
      'mahmoud-sharif',
      'mariam-qotob',
      'mohamed-rashad',
      'mohamed-samy',
      'new-person',
    ]);
    expect(file.speakers.find((s) => s.slug === 'aya-nasser-salama')).toMatchObject({
      bioEn: 'Senior MLOps engineer.',
      photoUrl: '/speakers/aya-nasser-salama.webp',
      linkedinUrl: 'https://www.linkedin.com/in/ayanasser/',
    });
    expect(file.speakers.find((s) => s.slug === 'mahmoud-sharif')!.photoUrl).toBeUndefined();
  });

  it('adds channel videos that have no session, skips known non-sessions, and falls back to English', () => {
    const slugs = file.sessions.map((s) => s.slug);
    expect(slugs).not.toContain('from-devops-to-mlops');
    const added = file.sessions.find((s) => s.slug === 'some-future-video')!;
    expect(added).toMatchObject({ titleEn: 'Some Future Video!', titleAr: '', startsAt: '2026-11-01T10:00:00.000Z', durationMin: 60 });
    // An uncurated website session gets no Arabic rather than a guess.
    expect(file.sessions.find((s) => s.slug === 'brand-new-talk')).toMatchObject({ titleAr: '', descriptionAr: '', durationMin: 120 });
  });

  it('lists announced courses as coming soon without claiming a price', () => {
    expect(file.courses.find((c) => c.slug === 'llmops')).toMatchObject({ status: 'COMING_SOON', type: 'PAID', price: 0 });
  });

  it('rejects impossible dates', () => {
    const r = archiveFileSchema.safeParse({ version: 1, sessions: [{ slug: 'x', titleEn: 'Talk', startsAt: '2026-08-37T19:00:00+03:00' }] });
    expect(r.success).toBe(false);
    expect(archiveFileSchema.safeParse({ version: 1, sessions: [{ slug: 'x', titleEn: 'Talk', startsAt: '2026-02-28T19:00:00+02:00' }] }).success).toBe(true);
  });

  it('keeps the committed archive files valid', () => {
    const archive = readArchive();
    expect(archive.courses.length).toBeGreaterThan(0);
    expect(() => parseArchive([{ name: 'a.json', data: { version: 1, speakers: [archive.speakers[0]] } }, { name: 'b.json', data: { version: 1, speakers: [archive.speakers[0]] } }])).toThrow(
      /Duplicate speaker slug/,
    );
  });
});
