import { theme, colors, radius, elementColors } from '../index';

describe('theme tokens', () => {
  it('uses the warm-cream primary background', () => {
    expect(colors.bgPrimary).toBe('#FFF3E0');
    expect(colors.textPrimary).toBe('#3C2415');
    expect(colors.red).toBe('#E23D28');
  });

  it('exposes the five-element chart colors', () => {
    expect(elementColors.木).toBe('#2E7D32');
    expect(elementColors.火).toBe('#D32F2F');
    expect(elementColors.水).toBe('#1565C0');
  });

  it('default card radius is 16', () => {
    expect(radius.lg).toBe(16);
  });

  it('aggregates all token groups', () => {
    expect(theme.colors).toBe(colors);
    expect(Object.keys(theme)).toEqual(
      expect.arrayContaining([
        'colors',
        'elementColors',
        'radius',
        'spacing',
        'shadows',
        'fonts',
        'fontSize',
      ]),
    );
  });
});
