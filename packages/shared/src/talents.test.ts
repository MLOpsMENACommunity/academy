import { describe, expect, it } from 'vitest';
import {
  availableForProjects,
  roleSkillQuery,
  seniorityBand,
  summarizeTalents,
  talentFilterSchema,
  talentScore,
  TALENT_BENCH_SIZE,
  type TalentRow,
} from './talents';

const row = (over: Partial<TalentRow> = {}): TalentRow => ({
  id: 'u1',
  name: 'Layla',
  country: 'EG',
  jobTitle: 'ML Engineer',
  employmentStatus: 'EMPLOYED_FULL_TIME',
  experienceYears: 'Y3_5',
  mlExperienceYears: 'Y1_3',
  seniority: 'MID',
  primaryArea: 'MLOPS',
  secondaryAreas: [],
  industry: null,
  educationLevel: 'BACHELORS',
  skills: {},
  cloudPlatforms: [],
  productionTools: [],
  learningGoals: [],
  interestedTopics: [],
  weeklyHours: null,
  enrollments: 0,
  certificates: 0,
  attendedSessions: 0,
  markedSessions: 0,
  gradedScore: 0,
  gradedMax: 0,
  points: 0,
  ...over,
});

describe('talent filter', () => {
  it('takes the profile filters and a population, defaulting to everyone', () => {
    const f = talentFilterSchema.parse({ country: 'EG,SA', skills: 'KUBERNETES:3' });
    expect(f.population).toBe('all');
    expect(f.country).toEqual(['EG', 'SA']);
    expect(f.skills).toEqual([{ skill: 'KUBERNETES', min: 3 }]);
    expect(talentFilterSchema.safeParse({ population: 'everyone' }).success).toBe(false);
  });
});

describe('talentScore', () => {
  it('is 0 for an empty profile and 100 at the top of every part', () => {
    expect(talentScore(row({ mlExperienceYears: null }))).toBe(0);
    expect(
      talentScore(
        row({
          skills: { PYTHON: 5, SQL: 5, DOCKER: 5, KUBERNETES: 5, CI_CD: 5, GIT: 1 },
          mlExperienceYears: 'Y10_PLUS',
          certificates: 1,
          attendedSessions: 10,
          markedSessions: 10,
          gradedScore: 50,
          gradedMax: 50,
        }),
      ),
    ).toBe(100);
  });

  it('counts the five best skills, missing ones as 0', () => {
    // 5 / 25 * 45 = 9, ML experience Y0_1 = 0.
    expect(talentScore(row({ skills: { PYTHON: 5 }, mlExperienceYears: 'Y0_1' }))).toBe(9);
  });
});

describe('seniority bands and availability', () => {
  it('groups seniorities for staffing', () => {
    expect(seniorityBand('INTERN')).toBe('junior');
    expect(seniorityBand('MID')).toBe('mid');
    expect(seniorityBand('HEAD_DIRECTOR')).toBe('senior');
    expect(seniorityBand(null)).toBe('unknown');
  });

  it('is available when freelancing, job seeking or aiming to freelance', () => {
    expect(availableForProjects(row({ employmentStatus: 'FREELANCER' }))).toBe(true);
    expect(availableForProjects(row({ employmentStatus: 'JOB_SEEKING' }))).toBe(true);
    expect(availableForProjects(row({ learningGoals: ['FREELANCING'] }))).toBe(true);
    expect(availableForProjects(row())).toBe(false);
  });
});

describe('summarizeTalents', () => {
  const rows = [
    row({ id: 'a', seniority: 'SENIOR', skills: { PYTHON: 4, DOCKER: 4, KUBERNETES: 3, CI_CD: 3, MLOPS_TOOLING: 5 }, employmentStatus: 'FREELANCER', productionTools: ['Docker', 'MLflow'], certificates: 1, enrollments: 1, attendedSessions: 3, markedSessions: 4, gradedScore: 8, gradedMax: 10, points: 40 }),
    row({ id: 'b', seniority: 'JUNIOR', skills: { PYTHON: 3, DOCKER: 3, KUBERNETES: 3, CI_CD: 3, MLOPS_TOOLING: 3 }, productionTools: ['docker ', 'MLflow', 'mlflow'], enrollments: 1, attendedSessions: 1, markedSessions: 2, points: 10 }),
    row({ id: 'c', seniority: null, skills: { PYTHON: 2 }, productionTools: ['Docker'], country: 'SA', experienceYears: 'Y10_PLUS' }),
  ];
  const s = summarizeTalents(rows);

  it('counts the headline totals', () => {
    expect(s.totals).toEqual({
      talents: 3,
      withSkills: 3,
      withStrongSkill: 1,
      available: 1,
      enrolled: 2,
      certified: 1,
      experienced: 1,
    });
  });

  it('ranks skills by how many students are strong in them, then by average', () => {
    expect(s.skills.slice(0, 3).map((x) => x.skill)).toEqual(['MLOPS_TOOLING', 'DOCKER', 'PYTHON']);
    expect(s.skills[0]).toEqual({ skill: 'MLOPS_TOOLING', rated: 2, average: 4, strong: 1, expert: 1 });
    expect(s.skills.find((x) => x.skill === 'PYTHON')).toEqual({ skill: 'PYTHON', rated: 3, average: 3, strong: 1, expert: 0 });
    expect(s.skills.find((x) => x.skill === 'AGENTS')).toEqual({ skill: 'AGENTS', rated: 0, average: null, strong: 0, expert: 0 });
  });

  it('counts high-skill AI engineers (4+ in Python, LLMs/RAG and agents), by seniority band', () => {
    const ai = summarizeTalents([
      row({ id: 'x', seniority: 'SENIOR', employmentStatus: 'FREELANCER', skills: { PYTHON: 5, LLMS_RAG: 4, AGENTS: 4 } }),
      row({ id: 'y', seniority: 'JUNIOR', skills: { PYTHON: 4, LLMS_RAG: 4, AGENTS: 4 } }),
      // One point short on agents.
      row({ id: 'z', seniority: 'SENIOR', skills: { PYTHON: 5, LLMS_RAG: 5, AGENTS: 3 } }),
    ]).roles.find((r) => r.key === 'AI_ENGINEER')!;
    expect(ai).toMatchObject({ total: 2, available: 1, bands: { junior: 1, mid: 0, senior: 1, unknown: 0 } });
    expect(ai.skills).toBe('PYTHON:4,LLMS_RAG:4,AGENTS:4');
    expect(roleSkillQuery('AI_ENGINEER')).toBe(ai.skills);
  });

  it('merges tool spellings, counting each student once', () => {
    expect(s.tools).toEqual([
      { key: 'Docker', count: 3 },
      { key: 'MLflow', count: 2 },
    ]);
  });

  it('shows a tied tool in the spelling with capitals', () => {
    expect(summarizeTalents([row({ id: 'x', productionTools: ['mlflow'] }), row({ id: 'y', productionTools: ['MLflow'] })]).tools).toEqual([{ key: 'MLflow', count: 2 }]);
  });

  it('keeps ordered enums in order and sorts the rest biggest first', () => {
    expect(s.seniority.map((x) => x.key)).toEqual(['JUNIOR', 'SENIOR']);
    expect(s.country).toEqual([
      { key: 'EG', count: 2 },
      { key: 'SA', count: 1 },
    ]);
  });

  it('averages the academy record over students who have one', () => {
    // Attendance 75% and 50%; graded work only for "a".
    expect(s.record).toEqual({ enrolled: 2, certified: 1, attendance: 63, graded: 80, points: 50 });
  });

  it('ranks the bench by score with each student’s best skills', () => {
    expect(s.bench.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(s.bench[0]!.topSkills).toEqual([
      { skill: 'MLOPS_TOOLING', level: 5 },
      { skill: 'PYTHON', level: 4 },
      { skill: 'DOCKER', level: 4 },
    ]);
    expect(s.bench[0]).toMatchObject({ attendance: 75, graded: 80, available: true });
    expect(s.bench[2]).toMatchObject({ attendance: null, graded: null });
  });

  it('caps the bench', () => {
    const many = Array.from({ length: TALENT_BENCH_SIZE + 5 }, (_, i) => row({ id: `u${i}` }));
    expect(summarizeTalents(many).bench).toHaveLength(TALENT_BENCH_SIZE);
  });

  it('handles nobody', () => {
    const empty = summarizeTalents([]);
    expect(empty.totals.talents).toBe(0);
    expect(empty.record.attendance).toBeNull();
    expect(empty.bench).toEqual([]);
  });
});
