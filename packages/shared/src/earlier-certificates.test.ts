import { describe, expect, it } from 'vitest';
import { codeFromScan, normalizeCertificateCode, parseEarlierCertificatesCsv } from './earlier-certificates';

describe('normalizeCertificateCode', () => {
  it('accepts academy serials and earlier codes in any case, trimmed', () => {
    expect(normalizeCertificateCode(' mlops-01-2026-00023 ')).toBe('MLOPS-01-2026-00023');
    expect(normalizeCertificateCode('mma-2026-7kq4xm2p')).toBe('MMA-2026-7KQ4XM2P');
    expect(normalizeCertificateCode('ABC-12345')).toBe('ABC-12345');
  });

  it('rejects what is not a code', () => {
    for (const bad of ['', 'ABC', 'NO SPACES-1', '-ABC-123', 'ABC--123', 'A'.repeat(41), '<script>-1']) expect(normalizeCertificateCode(bad)).toBeNull();
  });
});

describe('codeFromScan', () => {
  it('reads a bare code (earlier certificates) and links from academy QR codes', () => {
    expect(codeFromScan('MLOPS-01-2026-00023')).toBe('MLOPS-01-2026-00023');
    expect(codeFromScan('https://academy.mlopsmena.com/en/certificates/MMA-2026-7KQ4XM2P')).toBe('MMA-2026-7KQ4XM2P');
    expect(codeFromScan('https://academy.mlopsmena.com/ar/verify-certificate?code=mlops-01-2026-00023')).toBe('MLOPS-01-2026-00023');
    expect(codeFromScan('https://mlopsmena.com/tools/verify-certificate/?code=MLOPS-01-2026-00023')).toBe('MLOPS-01-2026-00023');
  });

  it('ignores other QR codes', () => {
    expect(codeFromScan('https://example.com/menu')).toBeNull();
    expect(codeFromScan('WIFI:S:home;T:WPA;P:secret;;')).toBeNull();
  });
});

describe('parseEarlierCertificatesCsv', () => {
  const header = 'code,holder_name,course,issued_on,status,email';

  it('reads the verification sheet, with dates as YYYY/MM/DD or YYYY-MM-DD and defaults', () => {
    const { rows, errors } = parseEarlierCertificatesCsv(
      `${header}\nmlops-01-2026-00023,  Sara   Ahmed ,The MLOps Practitioner Course,2026/11/02,valid,Sara@Example.com\nMLOPS-01-2026-00024,Omar Hassan,The MLOps Practitioner Course,2026-11-03,,\n`,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      line: 2,
      code: 'MLOPS-01-2026-00023',
      holderName: 'Sara Ahmed',
      courseTitle: 'The MLOps Practitioner Course',
      issuedOn: '2026-11-02',
      kind: 'ATTENDANCE',
      revoked: false,
      revokeReason: null,
      email: 'sara@example.com',
    });
    expect(rows[1]).toMatchObject({ issuedOn: '2026-11-03', revoked: false, email: null });
  });

  it('takes columns in any order and case, and revoked rows with a reason', () => {
    const { rows, errors } = parseEarlierCertificatesCsv('Issued On,Name,Code,Course,Status,Revoke Reason,Kind\n2026/01/31,Ali,ABC-12345,Course X,REVOKED,Duplicate,completion');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ code: 'ABC-12345', holderName: 'Ali', revoked: true, revokeReason: 'Duplicate', kind: 'COMPLETION' });
  });

  it('reports each bad line, duplicates and missing columns', () => {
    const { errors } = parseEarlierCertificatesCsv(
      `${header}\nnot a code,A Name,C,2026/01/01,valid,\nABC-12345,A Name,Course,2026/02/30,valid,\nABC-12346,A Name,Course,2026/02/01,lost,\nABC-12347,A Name,Course,2026/02/01,valid,nope\nABC-12348,A Name,Course,2026/02/01,valid,\nabc-12348,B Name,Course,2026/02/01,valid,`,
    );
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 7]);
    expect(errors[4]!.message).toBe('The same code as line 6');
    expect(parseEarlierCertificatesCsv('code,name\nABC-12345,X').errors[0]!.line).toBe(1);
    expect(parseEarlierCertificatesCsv('').errors[0]!.message).toBe('The file is empty');
  });
});
