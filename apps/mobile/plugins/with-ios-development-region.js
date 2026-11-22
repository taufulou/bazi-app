/**
 * Config plugin: make Chinese the iOS project's development region (1C item 9).
 *
 * Expo's `locales` config writes the zh-Hant / zh-Hans `.lproj` folders, and
 * `ios.infoPlist.CFBundleDevelopmentRegion` sets the Info.plist key — but the
 * Xcode project itself stays `developmentRegion = en` with `knownRegions = (en,
 * Base)`, as a prebuild showed. This aligns the project with the bundle so the
 * App Store does not list English, a language the app does not have.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withXcodeProject } = require('expo/config-plugins');

const quote = (r) => (/^[A-Za-z]+$/.test(r) ? r : `"${r}"`);
const unquote = (r) => String(r).replace(/"/g, '');

module.exports = function withIosDevelopmentRegion(config, options = {}) {
  const region = options.region ?? 'zh-Hant';
  const regions = options.regions ?? ['zh-Hant', 'zh-Hans'];
  return withXcodeProject(config, (cfg) => {
    const root = cfg.modResults.getFirstProject().firstProject;
    root.developmentRegion = quote(region);
    // Base stays (storyboards may live there); English goes — no en.lproj ships.
    const known = new Set(
      (root.knownRegions ?? []).map(unquote).filter((r) => r !== 'en'),
    );
    for (const r of [...regions, 'Base']) known.add(r);
    root.knownRegions = [...known].map(quote);
    return cfg;
  });
};
