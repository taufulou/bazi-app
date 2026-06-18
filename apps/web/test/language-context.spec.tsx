/**
 * LanguageContext provider-OPTIONAL hooks. Without a provider mounted, the consumer
 * hooks must return safe defaults (identity / 'zh-TW' / no-op) so leaf components and
 * unit tests render byte-identical Traditional output. This is the "zh-TW is a no-op"
 * guarantee for the whole conversion layer.
 */
import { render, screen } from '@testing-library/react';
import { useZh, useLang, useChangeLanguage } from '../app/components/LanguageContext';

function Probe() {
  const zh = useZh();
  const lang = useLang();
  const change = useChangeLanguage();
  return (
    <div>
      <span data-testid="converted">{zh('比劫奪財')}</span>
      <span data-testid="lang">{lang}</span>
      <span data-testid="change-type">{typeof change}</span>
    </div>
  );
}

describe('LanguageContext hooks without a provider', () => {
  test('useZh is identity (no conversion → Traditional preserved)', () => {
    render(<Probe />);
    expect(screen.getByTestId('converted').textContent).toBe('比劫奪財');
  });

  test("useLang defaults to 'zh-TW'", () => {
    render(<Probe />);
    expect(screen.getByTestId('lang').textContent).toBe('zh-TW');
  });

  test('useChangeLanguage is a callable no-op', () => {
    render(<Probe />);
    expect(screen.getByTestId('change-type').textContent).toBe('function');
  });
});
