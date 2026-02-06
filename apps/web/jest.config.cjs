/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testRegex: '.*\\.spec\\.(ts|tsx)$',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        module: 'commonjs',
        moduleResolution: 'node',
        allowImportingTsExtensions: false,
      },
    }],
  },
  moduleNameMapper: {
    '\\.module\\.css$': 'identity-obj-proxy',
    '\\.css$': 'identity-obj-proxy',
    '^@repo/shared(.*)$': '<rootDir>/../../packages/shared/src$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};
