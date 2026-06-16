/**
 * HeroBanner — admin-managed banner regression lock.
 *
 * - Falls back to the built-in gradient slides while loading / when there are
 *   no active admin banners (no regression to today's look).
 * - Once active banners load, renders each as a clickable <picture> linking to
 *   the chosen internal page, with art-directed desktop/mobile crops.
 */
import { render, screen } from '@testing-library/react';
import HeroBanner from '../app/components/HeroBanner';

// next/link → plain anchor (no router context needed in jsdom).
jest.mock('next/link', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('../app/lib/banner-api', () => ({ getActiveBanners: jest.fn() }));
import { getActiveBanners } from '../app/lib/banner-api';
const mockGet = getActiveBanners as jest.Mock;

beforeAll(() => {
  // jsdom polyfills used by the carousel.
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    media: '',
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  });
  // @ts-expect-error minimal IntersectionObserver polyfill
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function () {};
  }
});

afterEach(() => jest.clearAllMocks());

describe('HeroBanner', () => {
  it('renders the built-in gradient fallback when there are no admin banners', async () => {
    mockGet.mockResolvedValue([]);
    render(<HeroBanner />);
    expect(await screen.findByText('AI 命理，精準解命')).toBeInTheDocument();
    expect(screen.getByText('合盤分析上線')).toBeInTheDocument();
  });

  it('renders admin banner image slides as clickable internal links once loaded', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'b1',
        imageUrlDesktop: 'https://cdn.test/banners/d1.png',
        imageUrlMobile: 'https://cdn.test/banners/m1.png',
        linkHref: '/reading/annual',
        altText: '年運優惠',
      },
      {
        id: 'b2',
        imageUrlDesktop: 'https://cdn.test/banners/d2.png',
        imageUrlMobile: 'https://cdn.test/banners/m2.png',
        linkHref: '/pricing',
        altText: null,
      },
    ]);
    render(<HeroBanner />);

    const img1 = await screen.findByAltText('年運優惠');
    expect(img1).toHaveAttribute('src', 'https://cdn.test/banners/d1.png');
    expect(img1.closest('a')).toHaveAttribute('href', '/reading/annual');

    // Fallback content is gone once images load.
    expect(screen.queryByText('AI 命理，精準解命')).not.toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/pricing')).toBe(true);
  });

  it('emits a mobile <source> with the mobile crop for art direction', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'b1',
        imageUrlDesktop: 'https://cdn.test/banners/d1.png',
        imageUrlMobile: 'https://cdn.test/banners/m1.png',
        linkHref: '/',
        altText: 'x',
      },
    ]);
    const { container } = render(<HeroBanner />);
    await screen.findByAltText('x');

    const source = container.querySelector('source');
    expect(source).toHaveAttribute('media', '(max-width: 768px)');
    expect(source).toHaveAttribute('srcset', 'https://cdn.test/banners/m1.png');
  });
});
