// Metro config for the Expo mobile app inside the npm-workspaces monorepo.
// Handles: (1) watching the whole workspace so shared packages (@repo/shared)
// hot-reload, (2) resolving from both the app and the workspace root, and
// (3) pinning a SINGLE copy of react + react-native into the bundle — the
// monorepo hoists react-native@0.86 at root but a stray react@19.2.x patch can
// exist at both levels; forcing one copy avoids "two React/react-native" runtime
// errors. Pins are resolved via require.resolve so they follow wherever npm
// hoists the package (nested under apps/mobile OR at the root).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo (shared packages live outside apps/mobile).
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then fall back to the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force a single copy of the framework packages into the bundle.
const singletons = ['react', 'react-native'];
config.resolver.extraNodeModules = Object.fromEntries(
  singletons.map((name) => [
    name,
    path.dirname(require.resolve(`${name}/package.json`, { paths: [projectRoot] })),
  ]),
);

module.exports = config;
