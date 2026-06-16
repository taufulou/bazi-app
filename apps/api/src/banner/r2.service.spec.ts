const sendMock = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ __cmd: 'put', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ __cmd: 'delete', input })),
}));

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { R2Service } from './r2.service';

const FULL: Record<string, string> = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'bazi-banners',
  R2_PUBLIC_BASE_URL: 'https://cdn.test',
};

function cfg(map: Record<string, string>): ConfigService {
  return { get: (k: string) => map[k] ?? '' } as unknown as ConfigService;
}

describe('R2Service', () => {
  beforeEach(() => {
    sendMock.mockClear();
    (S3Client as unknown as jest.Mock).mockClear();
    (PutObjectCommand as unknown as jest.Mock).mockClear();
  });

  it('constructs WITHOUT R2 env (lazy) and reports isConfigured=false', () => {
    const svc = new R2Service(cfg({}));
    expect(svc.isConfigured()).toBe(false);
    // The S3Client must NOT be built at construction/isConfigured time.
    expect(S3Client as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it('isConfigured=true when all R2 env vars are present', () => {
    expect(new R2Service(cfg(FULL)).isConfigured()).toBe(true);
  });

  it('uploadImage PUTs with sniffed ContentType + immutable cache + banners/ key, returns the public URL', async () => {
    const svc = new R2Service(cfg(FULL));
    const url = await svc.uploadImage(Buffer.from('x'), 'png', 'image/png');

    expect(url).toMatch(/^https:\/\/cdn\.test\/banners\/[0-9a-f-]+\.png$/);
    const putArg = (PutObjectCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(putArg).toMatchObject({
      Bucket: 'bazi-banners',
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    expect(putArg.Key).toMatch(/^banners\/[0-9a-f-]+\.png$/);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('strips a trailing slash from R2_PUBLIC_BASE_URL', async () => {
    const svc = new R2Service(cfg({ ...FULL, R2_PUBLIC_BASE_URL: 'https://cdn.test/' }));
    const url = await svc.uploadImage(Buffer.from('x'), 'webp', 'image/webp');
    expect(url).toMatch(/^https:\/\/cdn\.test\/banners\/[0-9a-f-]+\.webp$/);
  });

  it('deleteImage skips URLs not under the configured public base (no send)', async () => {
    const svc = new R2Service(cfg(FULL));
    await svc.deleteImage('https://other.host/banners/x.png');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('deleteImage deletes a key under our base', async () => {
    const svc = new R2Service(cfg(FULL));
    await svc.deleteImage('https://cdn.test/banners/abc.png');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('deleteImage never throws, even when R2 is unconfigured or send fails', async () => {
    await expect(new R2Service(cfg({})).deleteImage('https://cdn.test/banners/x.png')).resolves.toBeUndefined();
    sendMock.mockRejectedValueOnce(new Error('R2 down'));
    await expect(new R2Service(cfg(FULL)).deleteImage('https://cdn.test/banners/x.png')).resolves.toBeUndefined();
  });
});
