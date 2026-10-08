import { detectFileType } from './file-type';

describe('detectFileType', () => {
  it('detects jpeg, png and pdf by magic bytes', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(detectFileType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('rejects a renamed file whose bytes do not match', () => {
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
