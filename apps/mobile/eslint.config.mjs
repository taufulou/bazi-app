import { config as reactConfig } from '@repo/eslint-config/react-internal';

/**
 * ESLint flat config for the Expo mobile app. Extends the monorepo's shared
 * React config and layers in the React Native runtime global (__DEV__) plus
 * ignores for generated/config files.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...reactConfig,
  {
    languageOptions: {
      globals: {
        __DEV__: 'readonly',
      },
    },
  },
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'expo-env.d.ts',
      'babel.config.js',
      'metro.config.js',
      'jest.config.js',
      'jest.setup.ts',
    ],
  },
];
