import { EXPERIENCE_RANGES, WEEKLY_HOURS, type ProfileFilter } from '@academy/shared';
import type { Prisma } from '@prisma/client';

const atLeast = <T extends string>(ordered: readonly T[], min: T): T[] => ordered.slice(ordered.indexOf(min));

/** Profile conditions shared by the applications table and the students directory. */
export function profileWhere(f: ProfileFilter): Prisma.ProfileWhereInput {
  const and: Prisma.ProfileWhereInput[] = [];
  if (f.country?.length) and.push({ country: { in: f.country } });
  if (f.experienceMin) and.push({ experienceYears: { in: atLeast(EXPERIENCE_RANGES, f.experienceMin) } });
  if (f.mlExperienceMin) and.push({ mlExperienceYears: { in: atLeast(EXPERIENCE_RANGES, f.mlExperienceMin) } });
  if (f.seniority?.length) and.push({ seniority: { in: f.seniority } });
  if (f.primaryArea?.length) and.push({ primaryArea: { in: f.primaryArea } });
  if (f.secondaryArea?.length) and.push({ secondaryAreas: { hasSome: f.secondaryArea } });
  if (f.employmentStatus?.length) and.push({ employmentStatus: { in: f.employmentStatus } });
  if (f.educationLevel?.length) and.push({ educationLevel: { in: f.educationLevel } });
  for (const s of f.skills ?? []) and.push({ skills: { some: { skill: s.skill, level: { gte: s.min } } } });
  if (f.cloud?.length) and.push({ cloudPlatforms: { hasSome: f.cloud } });
  if (f.weeklyHoursMin) and.push({ weeklyHours: { in: atLeast(WEEKLY_HOURS, f.weeklyHoursMin) } });
  if (f.topic?.length) and.push({ interestedTopics: { hasSome: f.topic } });
  if (f.openToOpportunities !== undefined) and.push({ openToOpportunities: f.openToOpportunities });
  if (f.shareWithPartners !== undefined) and.push({ shareWithPartners: f.shareWithPartners });
  return and.length ? { AND: and } : {};
}

/** Free-text search over the user and their profile. */
export function userSearch(q: string | undefined): Prisma.UserWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { email: contains },
      { profile: { fullNameEn: contains } },
      { profile: { fullNameAr: contains } },
      { profile: { jobTitle: contains } },
      { profile: { company: contains } },
      { profile: { city: contains } },
    ],
  };
}

/** Whether any profile filter is set (so we can require a profile to exist). */
export function hasProfileFilter(f: ProfileFilter): boolean {
  return Object.keys(profileWhere(f)).length > 0;
}
