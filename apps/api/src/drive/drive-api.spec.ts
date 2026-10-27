import { driveFolderId, parseServiceAccount } from './drive-api';

describe('Drive helpers', () => {
  it('reads the folder id from Drive folder links only', () => {
    expect(driveFolderId('https://drive.google.com/drive/folders/1AbC-dEf_GhIjKlMn')).toBe('1AbC-dEf_GhIjKlMn');
    expect(driveFolderId('https://drive.google.com/drive/u/1/folders/1AbC-dEf_GhIjKlMn?usp=sharing')).toBe('1AbC-dEf_GhIjKlMn');
    expect(driveFolderId('https://drive.google.com/open?id=1AbC-dEf_GhIjKlMn')).toBe('1AbC-dEf_GhIjKlMn');
    expect(driveFolderId('https://drive.google.com/file/d/1AbC-dEf_GhIjKlMn/view')).toBeNull();
    expect(driveFolderId('https://evil.example/drive/folders/1AbC-dEf_GhIjKlMn')).toBeNull();
    expect(driveFolderId(null)).toBeNull();
  });

  it('accepts the service account key as JSON or base64, and nothing else', () => {
    const key = JSON.stringify({ type: 'service_account', client_email: 'sa@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n' });
    const parsed = { clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: expect.stringContaining('PRIVATE KEY') };
    expect(parseServiceAccount(key)).toEqual(parsed);
    expect(parseServiceAccount(Buffer.from(key).toString('base64'))).toEqual(parsed);
    expect(parseServiceAccount('{"client_email":"x"}')).toBeNull();
    expect(parseServiceAccount('not a key')).toBeNull();
    expect(parseServiceAccount(undefined)).toBeNull();
  });
});
