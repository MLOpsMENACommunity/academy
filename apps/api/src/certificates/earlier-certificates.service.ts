import { Injectable } from '@nestjs/common';
import {
  COURSE_SERIAL_PATTERN,
  normalizeCertificateCode,
  parseEarlierCertificatesCsv,
  type EarlierCertificatesImportResultDto,
  type MyCertificateDto,
  type PublicCertificateDto,
} from '@academy/shared';
import type { ExternalCertificate } from '@prisma/client';
import type { Actor } from '../applications/workflow.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** The fields an import sets; a row whose stored values already match is "unchanged". */
type Fields = Pick<ExternalCertificate, 'holderName' | 'courseTitle' | 'kind' | 'issuedOn' | 'revokedAt' | 'revokeReason' | 'email'>;

/**
 * Certificates issued before the academy (the n8n workflow and its public verification sheet):
 * imported by an admin so their codes keep verifying here, and linked to the student's account
 * when its verified email matches.
 */
@Injectable()
export class EarlierCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks the file (dry run) or saves it: all rows or none. Rows are matched on the code: new
   * codes are created, known ones updated; nothing is ever deleted. A code already used by an
   * academy certificate is refused. Afterwards each prefix's numbering continues after the
   * highest imported number, so new certificates never reuse an old code.
   */
  async importCsv(csv: string, dryRun: boolean, actor: Actor): Promise<EarlierCertificatesImportResultDto> {
    const { rows, errors } = parseEarlierCertificatesCsv(csv);
    const codes = rows.map((r) => r.code);
    const [existing, academy, total] = await Promise.all([
      this.prisma.externalCertificate.findMany({ where: { code: { in: codes } }, include: { user: { select: { deletedAt: true } } } }),
      this.prisma.certificate.findMany({ where: { serial: { in: codes } }, select: { serial: true } }),
      this.prisma.externalCertificate.count(),
    ]);
    const academyCodes = new Set(academy.map((c) => c.serial));
    for (const r of rows) if (academyCodes.has(r.code)) errors.push({ line: r.line, message: 'This code belongs to a certificate issued by the academy' });
    errors.sort((a, b) => a.line - b.line);

    const byCode = new Map(existing.map((e) => [e.code, e]));
    const accounts = await this.accountsByEmail(rows.flatMap((r) => (r.email ? [r.email] : [])));
    const plan = rows.map((r) => {
      const data: Fields = {
        holderName: r.holderName,
        courseTitle: r.courseTitle,
        kind: r.kind,
        issuedOn: new Date(`${r.issuedOn}T00:00:00Z`),
        // A revoked row keeps its first revocation date across re-imports.
        revokedAt: r.revoked ? (byCode.get(r.code)?.revokedAt ?? new Date()) : null,
        revokeReason: r.revokeReason,
        email: r.email,
      };
      const old = byCode.get(r.code);
      const userId = (r.email && accounts.get(r.email)) || old?.userId || null;
      // The holder deleted their account: a re-import must not bring back their name or email.
      const gone = Boolean(old?.user?.deletedAt);
      const action = !old ? 'create' : gone || (sameFields(old, data) && old.userId === userId) ? 'unchanged' : 'update';
      return { code: r.code, data, userId, action, linking: !gone && Boolean(userId && userId !== old?.userId) };
    });
    const result: EarlierCertificatesImportResultDto = {
      dryRun,
      rows: rows.length,
      created: plan.filter((p) => p.action === 'create').length,
      updated: plan.filter((p) => p.action === 'update').length,
      unchanged: plan.filter((p) => p.action === 'unchanged').length,
      linked: plan.filter((p) => p.linking).length,
      errors,
      total: total + plan.filter((p) => p.action === 'create').length,
    };
    if (dryRun || errors.length || !rows.length) return { ...result, total: errors.length ? total : result.total };

    await this.prisma.$transaction(
      async (tx) => {
        const fresh = plan.filter((p) => p.action === 'create');
        if (fresh.length) {
          await tx.externalCertificate.createMany({ data: fresh.map((p) => ({ code: p.code, ...p.data, userId: p.userId, importedById: actor.id })) });
        }
        for (const p of plan.filter((x) => x.action === 'update')) {
          await tx.externalCertificate.update({ where: { code: p.code }, data: { ...p.data, userId: p.userId, importedById: actor.id } });
        }
        // Continue each prefix's numbering after the highest imported number (MLOPS-01-2026-00208 → 209).
        const highest = new Map<string, number>();
        for (const code of codes) {
          if (!COURSE_SERIAL_PATTERN.test(code)) continue;
          const parts = code.split('-');
          const prefix = parts[0]!;
          highest.set(prefix, Math.max(highest.get(prefix) ?? 0, Number(parts[parts.length - 1])));
        }
        for (const [prefix, n] of highest) {
          await tx.$executeRaw`
            INSERT INTO "CertificateSequence" ("code", "next") VALUES (${prefix}, ${n + 1})
            ON CONFLICT ("code") DO UPDATE SET "next" = GREATEST("CertificateSequence"."next", ${n + 1})`;
        }
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'certificates.earlier_imported',
            entityType: 'ExternalCertificate',
            metadata: { rows: result.rows, created: result.created, updated: result.updated, linked: result.linked },
          },
          tx,
        );
      },
      { timeout: 60_000 },
    );
    return result;
  }

  /** Accounts by verified email (not deleted): only a confirmed address links a certificate. */
  private async accountsByEmail(emails: string[]): Promise<Map<string, string>> {
    if (!emails.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { email: { in: [...new Set(emails)], mode: 'insensitive' }, emailVerifiedAt: { not: null }, deletedAt: null },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  }

  /** Links unclaimed earlier certificates to this account when its verified email matches (e.g. a student who signed up later). */
  async linkForUser(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, deletedAt: true } });
    if (!u?.emailVerifiedAt || u.deletedAt) return;
    await this.prisma.externalCertificate.updateMany({ where: { userId: null, email: u.email.toLowerCase() }, data: { userId } });
  }

  /** The student's earlier certificates, for the dashboard (after linking any new matches). */
  async mine(userId: string): Promise<MyCertificateDto[]> {
    await this.linkForUser(userId);
    const list = await this.prisma.externalCertificate.findMany({ where: { userId }, orderBy: { issuedOn: 'desc' } });
    return list.map((c) => ({
      id: c.id,
      serial: c.code,
      status: c.revokedAt ? 'REVOKED' : 'VALID',
      issuedAt: c.issuedOn.toISOString(),
      grade: null,
      courseSlug: null,
      courseTitleEn: c.courseTitle,
      courseTitleAr: c.courseTitle,
      nameOnCertificate: c.holderName,
      pdf: false,
    }));
  }

  /** The public verification page for a code that isn't an academy certificate; null if unknown. */
  async publicView(raw: string): Promise<PublicCertificateDto | null> {
    const code = normalizeCertificateCode(raw);
    if (!code) return null;
    const c = await this.prisma.externalCertificate.findUnique({ where: { code }, include: { user: { select: { deletedAt: true, anonymizedAt: true } } } });
    if (!c) return null;
    // Linked to an account that was deleted: like academy certificates, nothing personal is shown.
    if (c.user?.deletedAt || c.user?.anonymizedAt) return { status: 'UNAVAILABLE', serial: c.code };
    return {
      status: c.revokedAt ? 'REVOKED' : 'VALID',
      kind: c.kind,
      serial: c.code,
      name: c.holderName,
      nameAr: null,
      courseSlug: null,
      courseTitleEn: c.courseTitle,
      courseTitleAr: c.courseTitle,
      instructors: [],
      issuedAt: c.issuedOn.toISOString(),
      grade: null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      pdf: false,
    };
  }
}

function sameFields(old: ExternalCertificate, next: Fields): boolean {
  return (
    old.holderName === next.holderName &&
    old.courseTitle === next.courseTitle &&
    old.kind === next.kind &&
    old.issuedOn.getTime() === next.issuedOn.getTime() &&
    Boolean(old.revokedAt) === Boolean(next.revokedAt) &&
    old.revokeReason === next.revokeReason &&
    old.email === next.email
  );
}
