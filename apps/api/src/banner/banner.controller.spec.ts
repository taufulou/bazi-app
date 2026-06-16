import { HttpException } from '@nestjs/common';
import { BannerAdminController, sniffImageType } from './banner.controller';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

function webp(): Buffer {
  const b = Buffer.alloc(16);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return b;
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const GIF = Buffer.from('GIF89a..........');

describe('sniffImageType', () => {
  it('accepts PNG / JPEG / WebP by magic bytes', () => {
    expect(sniffImageType(PNG)).toEqual({ ext: 'png', mime: 'image/png' });
    expect(sniffImageType(JPEG)).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(sniffImageType(webp())).toEqual({ ext: 'webp', mime: 'image/webp' });
  });

  it('rejects SVG / GIF / short buffers', () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it('rejects a RIFF container that is NOT WebP (e.g. WAV)', () => {
    const wav = Buffer.alloc(16);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe('BannerAdminController.upload', () => {
  const r2 = {
    uploadImage: jest.fn().mockResolvedValue('https://cdn.test/banners/x.png'),
    deleteImage: jest.fn(),
    isConfigured: jest.fn().mockReturnValue(true),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctrl = new BannerAdminController({} as any, r2 as any);

  const file = (buf: Buffer, size = buf.length) =>
    ({ buffer: buf, size } as Express.Multer.File);

  beforeEach(() => {
    r2.uploadImage.mockClear();
    r2.isConfigured.mockReturnValue(true);
  });

  it('400 when no file is provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(ctrl.upload(undefined as any)).rejects.toBeInstanceOf(HttpException);
  });

  it('400 when the file exceeds the 2 MB business limit', async () => {
    await expect(ctrl.upload(file(PNG, 3 * 1024 * 1024))).rejects.toBeInstanceOf(HttpException);
    expect(r2.uploadImage).not.toHaveBeenCalled();
  });

  it('400 when the bytes are not a real image (spoofed SVG)', async () => {
    await expect(ctrl.upload(file(SVG))).rejects.toBeInstanceOf(HttpException);
    expect(r2.uploadImage).not.toHaveBeenCalled();
  });

  it('uploads a valid PNG via the sniffed type and returns the URL', async () => {
    const res = await ctrl.upload(file(PNG));
    expect(res).toEqual({ url: 'https://cdn.test/banners/x.png' });
    expect(r2.uploadImage).toHaveBeenCalledWith(PNG, 'png', 'image/png');
  });

  it('503 R2_NOT_CONFIGURED when R2 is unconfigured (NOT rewrapped as UPLOAD_FAILED 500)', async () => {
    r2.isConfigured.mockReturnValueOnce(false);
    let caught: HttpException | undefined;
    try {
      await ctrl.upload(file(PNG));
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught!.getStatus()).toBe(503);
    expect((caught!.getResponse() as { code: string }).code).toBe('R2_NOT_CONFIGURED');
    expect(r2.uploadImage).not.toHaveBeenCalled();
  });
});
