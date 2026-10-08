-- A public "coming soon" status: listed, but not accepting applications.
ALTER TYPE "CourseStatus" ADD VALUE IF NOT EXISTS 'COMING_SOON' BEFORE 'OPEN';
