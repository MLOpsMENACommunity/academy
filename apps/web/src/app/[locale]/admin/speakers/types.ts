import type { InstructorDto } from '@academy/shared';

/** An instructor/speaker as the admin API lists it. */
export interface AdminSpeaker extends InstructorDto {
  /** "import" when the archive import created it. */
  source: string | null;
  courses: number;
  events: number;
}
