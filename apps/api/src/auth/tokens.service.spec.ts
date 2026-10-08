import { TokensService } from './tokens.service';

type Row = { id: string; family: string; userId: string; expiresAt: Date; rotatedAt: Date | null; revokedAt: Date | null; user: { deletedAt: Date | null } };

function setup(row: Partial<Row>) {
  const full: Row = {
    id: 't1', family: 'f1', userId: 'u1', expiresAt: new Date(Date.now() + 60_000),
    rotatedAt: null, revokedAt: null, user: { deletedAt: null }, ...row,
  };
  const prisma = {
    refreshToken: {
      findUnique: jest.fn().mockResolvedValue(full),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const svc = new TokensService(prisma as never, {} as never, { REFRESH_TOKEN_TTL_DAYS: 30 } as never);
  return { svc, prisma };
}

describe('TokensService.rotate', () => {
  it('rotates a fresh token', async () => {
    const { svc } = setup({});
    await expect(svc.rotate('tok')).resolves.toMatchObject({ ok: true });
  });
  it('treats a just-rotated token as a concurrent refresh, not theft', async () => {
    const { svc, prisma } = setup({ rotatedAt: new Date() });
    await expect(svc.rotate('tok')).resolves.toEqual({ ok: false, reason: 'concurrent' });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
  it('revokes the whole family when an old rotated token is replayed', async () => {
    const { svc, prisma } = setup({ rotatedAt: new Date(Date.now() - 60_000) });
    await expect(svc.rotate('tok')).resolves.toEqual({ ok: false, reason: 'reused' });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { family: 'f1', revokedAt: null } }));
  });
  it('rejects revoked, expired and deleted-user tokens', async () => {
    for (const row of [{ revokedAt: new Date() }, { expiresAt: new Date(0) }, { user: { deletedAt: new Date() } }]) {
      const { svc } = setup(row);
      await expect(svc.rotate('tok')).resolves.toEqual({ ok: false, reason: 'invalid' });
    }
  });
});
