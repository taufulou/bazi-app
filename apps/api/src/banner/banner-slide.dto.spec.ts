import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBannerSlideDto } from './dto/create-banner-slide.dto';
import { UpdateBannerSlideDto } from './dto/update-banner-slide.dto';

async function linkHrefErrors(linkHref: string) {
  const dto = plainToInstance(CreateBannerSlideDto, {
    imageUrlDesktop: 'https://cdn.test/banners/d.png',
    imageUrlMobile: 'https://cdn.test/banners/m.png',
    linkHref,
  });
  const errs = await validate(dto);
  return errs.find((e) => e.property === 'linkHref');
}

describe('CreateBannerSlideDto.linkHref validation', () => {
  it('accepts internal absolute paths', async () => {
    for (const ok of [
      '/reading/annual',
      '/pricing',
      '/',
      '/reading/fortune?tab=year',
      '/dashboard/profiles',
    ]) {
      expect(await linkHrefErrors(ok)).toBeUndefined();
    }
  });

  it('rejects protocol-relative, external, javascript, whitespace, backslash, and relative paths', async () => {
    for (const bad of [
      '//evil.com', // protocol-relative open-redirect
      'https://evil.com',
      'http://x',
      'javascript:alert(1)',
      '/a b', // whitespace
      '/a\\b', // backslash
      'reading/annual', // no leading slash
      '', // empty
    ]) {
      expect(await linkHrefErrors(bad)).toBeDefined();
    }
  });
});

async function imageUrlErrors(imageUrlDesktop: string) {
  const dto = plainToInstance(CreateBannerSlideDto, {
    imageUrlDesktop,
    imageUrlMobile: 'https://cdn.test/banners/m.png',
    linkHref: '/reading/lifetime',
  });
  const errs = await validate(dto);
  return errs.find((e) => e.property === 'imageUrlDesktop');
}

describe('CreateBannerSlideDto image-URL validation (https-only)', () => {
  it('accepts https R2 URLs', async () => {
    expect(await imageUrlErrors('https://pub-abc123.r2.dev/banners/x.png')).toBeUndefined();
    expect(await imageUrlErrors('https://cdn.test/banners/x.png')).toBeUndefined();
  });

  it('rejects data: URIs, non-URLs, empty strings, and plain http', async () => {
    for (const bad of [
      'data:image/svg+xml,<svg onload="alert(1)"></svg>',
      'not-a-url',
      '',
      'http://cdn.test/x.png', // https-only
    ]) {
      expect(await imageUrlErrors(bad)).toBeDefined();
    }
  });
});

async function updateImageUrlErrors(imageUrlDesktop: string) {
  const dto = plainToInstance(UpdateBannerSlideDto, { imageUrlDesktop });
  const errs = await validate(dto);
  return errs.find((e) => e.property === 'imageUrlDesktop');
}

describe('UpdateBannerSlideDto image-URL validation (https-only, optional)', () => {
  it('accepts an empty patch (all fields optional) and an https URL', async () => {
    expect((await validate(plainToInstance(UpdateBannerSlideDto, {}))).length).toBe(0);
    expect(await updateImageUrlErrors('https://cdn.test/banners/x.png')).toBeUndefined();
  });

  it('rejects data: URIs and plain http when present', async () => {
    expect(await updateImageUrlErrors('data:image/svg+xml,<svg></svg>')).toBeDefined();
    expect(await updateImageUrlErrors('http://cdn.test/x.png')).toBeDefined();
  });
});
