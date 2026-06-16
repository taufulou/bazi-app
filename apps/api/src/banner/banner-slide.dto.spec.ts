import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBannerSlideDto } from './dto/create-banner-slide.dto';

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
