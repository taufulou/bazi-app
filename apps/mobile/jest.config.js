// Jest config for the Expo mobile app. Uses the jest-expo preset (handles the
// RN/Expo module transform + JSDOM-free RN environment). transformIgnorePatterns
// allow-lists the ESM-published RN/Expo/Clerk/@repo packages so Babel transpiles
// them (node_modules is otherwise skipped by Jest).
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|react-native-worklets|@gorhom/.*|lucide-react-native|posthog-react-native|opencc-js|@clerk/.*|@repo/.*))',
  ],
  // Pin a SINGLE react copy for jest (the monorepo hoists react@19.2.7 at root but
  // apps/mobile nests a 19.2.3 patch; react-test-renderer/react-reconciler live at
  // root and load the root copy). Without this, a component's `react` import and the
  // renderer's differ → null hook dispatcher ("Cannot read properties of null
  // (reading 'useContext')"). Metro pins this for the bundle; jest needs its own map.
  moduleNameMapper: {
    '^react$': '<rootDir>/../../node_modules/react',
    '^react/(.*)$': '<rootDir>/../../node_modules/react/$1',
  },
};
