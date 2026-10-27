import { z } from 'zod';
import { profileFilterSchema } from './admin';
import {
  AREAS,
  EXPERIENCE_RANGES,
  SENIORITIES,
  SKILLS,
  WEEKLY_HOURS,
  type Skill,
} from './enums';
import type { Localized } from './labels';

/**
 * Admin → Talents: who our students are and what they can do, to staff outsourcing projects.
 * The API loads the matching students (talentFilterSchema) and summarizeTalents() turns them
 * into the page's figures, so every number here is computed one way and tested.
 */

// ------------------------------------------------------------------ filter

/** Which students count: everyone with a profile, those who applied, enrolled, or hold a certificate. */
export const TALENT_POPULATIONS = ['all', 'applicants', 'enrolled', 'certified'] as const;
export type TalentPopulation = (typeof TALENT_POPULATIONS)[number];

/** The students directory's profile filters, plus the population. */
export const talentFilterSchema = profileFilterSchema.extend({
  population: z.enum(TALENT_POPULATIONS).default('all'),
});
export type TalentFilter = z.infer<typeof talentFilterSchema>;

/** Most students the page summarises at once; beyond this the figures cover the first ones and say so. */
export const TALENT_LIMIT = 20_000;
/** Rows in the ranked bench. */
export const TALENT_BENCH_SIZE = 50;
/** Rows in the long lists (countries, tools). */
export const TALENT_TOP_N = 25;

// ------------------------------------------------------------------ roles

/**
 * Roles we staff on outsourcing projects, as minimum self-rated skill levels (1–5). A student
 * fits a role when they meet every minimum. Each role opens the same filter in the skill
 * filter ("PYTHON:4,LLMS_RAG:4"), so the bench shows who fits it. Add a role here when we
 * start selling it.
 */
export const TALENT_ROLES = [
  // High skill only: 4+ in each.
  { key: 'AI_ENGINEER', skills: { PYTHON: 4, LLMS_RAG: 4, AGENTS: 4 } },
] as const satisfies readonly { key: string; skills: Partial<Record<Skill, number>> }[];
export type TalentRoleKey = (typeof TALENT_ROLES)[number]['key'];

export const talentRoleLabels: Record<TalentRoleKey, Localized> = {
  AI_ENGINEER: { en: 'AI engineer (high skill)', ar: 'مهندس ذكاء اصطناعي (مهارة عالية)' },
};

/** The role's minimums as a skill filter value: "PYTHON:3,DOCKER:3". */
export function roleSkillQuery(role: TalentRoleKey): string {
  const r = TALENT_ROLES.find((x) => x.key === role)!;
  return Object.entries(r.skills)
    .map(([s, min]) => `${s}:${min}`)
    .join(',');
}

/** Seniority bands for staffing (a project asks for "2 seniors and a junior"). */
export const SENIORITY_BANDS = ['junior', 'mid', 'senior', 'unknown'] as const;
export type SeniorityBand = (typeof SENIORITY_BANDS)[number];

export function seniorityBand(s: string | null | undefined): SeniorityBand {
  if (s === 'INTERN' || s === 'JUNIOR') return 'junior';
  if (s === 'MID') return 'mid';
  if (s && (SENIORITIES as readonly string[]).includes(s)) return 'senior';
  return 'unknown';
}

// ------------------------------------------------------------------ input row

/** One student as the API loads them: their profile, plus what they did in our courses. */
export interface TalentRow {
  id: string;
  name: string | null;
  country: string | null;
  jobTitle: string | null;
  employmentStatus: string | null;
  experienceYears: string | null;
  mlExperienceYears: string | null;
  seniority: string | null;
  primaryArea: string | null;
  secondaryAreas: string[];
  industry: string | null;
  educationLevel: string | null;
  skills: Partial<Record<Skill, number>>;
  cloudPlatforms: string[];
  productionTools: string[];
  learningGoals: string[];
  interestedTopics: string[];
  weeklyHours: string | null;
  enrollments: number;
  /** Certificates not revoked. */
  certificates: number;
  /** Sessions marked present (1) or partial (0.5), out of the sessions with a mark. */
  attendedSessions: number;
  markedSessions: number;
  /** Sum of graded scores and of their maximums (quizzes, labs, assignments). */
  gradedScore: number;
  gradedMax: number;
  points: number;
}

// ------------------------------------------------------------------ score

/**
 * 0–100, to rank the bench. Self-rated skills 45 (the mean of the five best ratings, missing
 * ones counting 0), ML/AI experience 20, and the academy record 35: a certificate 15,
 * attendance 10 and graded work 10. Students who never studied with us score only on the first two.
 */
export function talentScore(r: Pick<TalentRow, 'skills' | 'mlExperienceYears' | 'certificates' | 'attendedSessions' | 'markedSessions' | 'gradedScore' | 'gradedMax'>): number {
  const top5 = Object.values(r.skills)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => b - a)
    .slice(0, 5);
  const skills = top5.reduce((a, b) => a + b, 0) / 25;
  const ml = EXPERIENCE_RANGES.indexOf(r.mlExperienceYears as (typeof EXPERIENCE_RANGES)[number]);
  const experience = ml >= 0 ? ml / (EXPERIENCE_RANGES.length - 1) : 0;
  const attendance = attendanceRate(r) ?? 0;
  const graded = gradedRate(r) ?? 0;
  const score = skills * 45 + experience * 20 + (r.certificates > 0 ? 15 : 0) + attendance * 10 + graded * 10;
  return Math.round(score);
}

/** 0–1, or null when no session was marked. */
export function attendanceRate(r: Pick<TalentRow, 'attendedSessions' | 'markedSessions'>): number | null {
  return r.markedSessions > 0 ? Math.min(1, r.attendedSessions / r.markedSessions) : null;
}

/** 0–1, or null when nothing was graded. */
export function gradedRate(r: Pick<TalentRow, 'gradedScore' | 'gradedMax'>): number | null {
  return r.gradedMax > 0 ? Math.max(0, Math.min(1, r.gradedScore / r.gradedMax)) : null;
}

/** Free to take project work now, or say they want to freelance. */
export function availableForProjects(r: Pick<TalentRow, 'employmentStatus' | 'learningGoals'>): boolean {
  return r.employmentStatus === 'FREELANCER' || r.employmentStatus === 'JOB_SEEKING' || r.learningGoals.includes('FREELANCING');
}

// ------------------------------------------------------------------ output

export interface TalentCount {
  key: string;
  count: number;
}

export interface TalentSkillStat {
  skill: Skill;
  /** Students who rated it. */
  rated: number;
  /** Mean rating among them, 1–5, one decimal; null when nobody rated it. */
  average: number | null;
  /** Rated 4 or 5. */
  strong: number;
  /** Rated 5. */
  expert: number;
}

export interface TalentRoleStat {
  key: TalentRoleKey;
  /** The role's skill filter value, e.g. "PYTHON:3,DOCKER:3". */
  skills: string;
  total: number;
  /** Of those, available for projects now. */
  available: number;
  bands: Record<SeniorityBand, number>;
}

export interface TalentBenchRow {
  id: string;
  name: string | null;
  jobTitle: string | null;
  country: string | null;
  seniority: string | null;
  mlExperienceYears: string | null;
  primaryArea: string | null;
  /** Best three ratings, highest first. */
  topSkills: { skill: Skill; level: number }[];
  certificates: number;
  /** 0–100, or null. */
  attendance: number | null;
  /** 0–100, or null. */
  graded: number | null;
  points: number;
  score: number;
  available: boolean;
}

export interface TalentInsightsDto {
  /** True when more students matched than TALENT_LIMIT: the figures cover the first ones. */
  truncated: boolean;
  totals: {
    talents: number;
    /** Rated at least one skill. */
    withSkills: number;
    /** Rated at least one skill 4 or 5. */
    withStrongSkill: number;
    available: number;
    enrolled: number;
    certified: number;
    /** Experience of 5 years or more. */
    experienced: number;
  };
  skills: TalentSkillStat[];
  roles: TalentRoleStat[];
  primaryArea: TalentCount[];
  secondaryAreas: TalentCount[];
  seniority: TalentCount[];
  experience: TalentCount[];
  mlExperience: TalentCount[];
  country: TalentCount[];
  employment: TalentCount[];
  education: TalentCount[];
  industry: TalentCount[];
  cloud: TalentCount[];
  tools: TalentCount[];
  goals: TalentCount[];
  topics: TalentCount[];
  weeklyHours: TalentCount[];
  record: {
    enrolled: number;
    certified: number;
    /** Mean attendance of students with marked sessions, 0–100; null when none. */
    attendance: number | null;
    /** Mean graded score of students with graded work, 0–100; null when none. */
    graded: number | null;
    /** Total points of the matching students. */
    points: number;
  };
  bench: TalentBenchRow[];
}

// ------------------------------------------------------------------ summary

function tally(values: Iterable<string | null | undefined>, order?: readonly string[]): TalentCount[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Ordered enums (seniority, experience) keep their order; everything else goes biggest first.
  if (order) return order.filter((k) => counts.has(k)).map((key) => ({ key, count: counts.get(key)! }));
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

const capitals = (v: string) => v.replace(/[^A-Z]/g, '').length;

/**
 * Production tools are free text: "Docker", "docker " and "DOCKER" are one tool, shown as most
 * students wrote it (on a tie, the spelling with capitals: "MLflow" over "mlflow").
 */
function tallyTools(rows: TalentRow[]): TalentCount[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const raw of r.productionTools) {
      const shown = raw.trim().replace(/\s+/g, ' ');
      const key = shown.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const g = groups.get(key) ?? { count: 0, spellings: new Map<string, number>() };
      g.count += 1;
      g.spellings.set(shown, (g.spellings.get(shown) ?? 0) + 1);
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ key: [...g.spellings.entries()].sort((a, b) => b[1] - a[1] || capitals(b[0]) - capitals(a[0]) || a[0].localeCompare(b[0]))[0]![0], count: g.count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TALENT_TOP_N);
}

function fitsRole(r: TalentRow, skills: Partial<Record<Skill, number>>): boolean {
  return Object.entries(skills).every(([s, min]) => (r.skills[s as Skill] ?? 0) >= (min as number));
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x: number | null): number | null => (x === null ? null : Math.round(x * 100));

export function summarizeTalents(rows: TalentRow[], truncated = false): TalentInsightsDto {
  const skills: TalentSkillStat[] = SKILLS.map((skill) => {
    const levels = rows.map((r) => r.skills[skill]).filter((v): v is number => typeof v === 'number');
    const avg = mean(levels);
    return {
      skill,
      rated: levels.length,
      average: avg === null ? null : Math.round(avg * 10) / 10,
      strong: levels.filter((l) => l >= 4).length,
      expert: levels.filter((l) => l === 5).length,
    };
  }).sort((a, b) => b.strong - a.strong || (b.average ?? 0) - (a.average ?? 0) || a.skill.localeCompare(b.skill));

  const roles: TalentRoleStat[] = TALENT_ROLES.map((role) => {
    const fit = rows.filter((r) => fitsRole(r, role.skills));
    const bands = Object.fromEntries(SENIORITY_BANDS.map((b) => [b, 0])) as Record<SeniorityBand, number>;
    for (const r of fit) bands[seniorityBand(r.seniority)] += 1;
    return { key: role.key, skills: roleSkillQuery(role.key), total: fit.length, available: fit.filter(availableForProjects).length, bands };
  });

  const attendances = rows.map(attendanceRate).filter((v): v is number => v !== null);
  const grades = rows.map(gradedRate).filter((v): v is number => v !== null);

  const bench: TalentBenchRow[] = rows
    .map((r) => ({ r, score: talentScore(r) }))
    .sort((a, b) => b.score - a.score || b.r.points - a.r.points || a.r.id.localeCompare(b.r.id))
    .slice(0, TALENT_BENCH_SIZE)
    .map(({ r, score }) => ({
      id: r.id,
      name: r.name,
      jobTitle: r.jobTitle,
      country: r.country,
      seniority: r.seniority,
      mlExperienceYears: r.mlExperienceYears,
      primaryArea: r.primaryArea,
      topSkills: (Object.entries(r.skills) as [Skill, number][])
        .sort((a, b) => b[1] - a[1] || SKILLS.indexOf(a[0]) - SKILLS.indexOf(b[0]))
        .slice(0, 3)
        .map(([skill, level]) => ({ skill, level })),
      certificates: r.certificates,
      attendance: pct(attendanceRate(r)),
      graded: pct(gradedRate(r)),
      points: r.points,
      score,
      available: availableForProjects(r),
    }));

  const ratedAny = (r: TalentRow) => Object.keys(r.skills).length > 0;
  const atLeast5y = new Set<string>(EXPERIENCE_RANGES.slice(EXPERIENCE_RANGES.indexOf('Y5_10')));

  return {
    truncated,
    totals: {
      talents: rows.length,
      withSkills: rows.filter(ratedAny).length,
      withStrongSkill: rows.filter((r) => Object.values(r.skills).some((v) => (v ?? 0) >= 4)).length,
      available: rows.filter(availableForProjects).length,
      enrolled: rows.filter((r) => r.enrollments > 0).length,
      certified: rows.filter((r) => r.certificates > 0).length,
      experienced: rows.filter((r) => r.experienceYears !== null && atLeast5y.has(r.experienceYears)).length,
    },
    skills,
    roles,
    primaryArea: tally(rows.map((r) => r.primaryArea)),
    secondaryAreas: tally(rows.flatMap((r) => r.secondaryAreas.filter((a) => (AREAS as readonly string[]).includes(a)))),
    seniority: tally(rows.map((r) => r.seniority), SENIORITIES),
    experience: tally(rows.map((r) => r.experienceYears), EXPERIENCE_RANGES),
    mlExperience: tally(rows.map((r) => r.mlExperienceYears), EXPERIENCE_RANGES),
    country: tally(rows.map((r) => r.country)).slice(0, TALENT_TOP_N),
    employment: tally(rows.map((r) => r.employmentStatus)),
    education: tally(rows.map((r) => r.educationLevel)),
    industry: tally(rows.map((r) => r.industry)),
    cloud: tally(rows.flatMap((r) => r.cloudPlatforms)),
    tools: tallyTools(rows),
    goals: tally(rows.flatMap((r) => r.learningGoals)),
    topics: tally(rows.flatMap((r) => r.interestedTopics)),
    weeklyHours: tally(rows.map((r) => r.weeklyHours), WEEKLY_HOURS),
    record: {
      enrolled: rows.filter((r) => r.enrollments > 0).length,
      certified: rows.filter((r) => r.certificates > 0).length,
      attendance: pct(mean(attendances)),
      graded: pct(mean(grades)),
      points: rows.reduce((a, r) => a + r.points, 0),
    },
    bench,
  };
}
