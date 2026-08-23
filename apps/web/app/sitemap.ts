import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/site-url';

const BASE_URL = SITE_URL;

const READING_SLUGS = [
  'lifetime',
  'annual',
  'career',
  'love',
  'health',
  'compatibility',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/sign-in`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/sign-up`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  const readingPages: MetadataRoute.Sitemap = READING_SLUGS.map((slug) => ({
    url: `${BASE_URL}/reading/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...readingPages];
}
