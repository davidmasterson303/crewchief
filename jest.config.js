const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    // Order matters: the scoped alias must be tried before the '@/' catch-all.
    '^@crewchief/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  /*
    Agent worktrees under .claude/worktrees are full checkouts, so every suite
    was being discovered twice — 24 suites and 338 tests against a real 12 and
    169. Harmless while the copies agree, actively misleading once they do not:
    a worktree pinned to an older commit reports its stale expectations as
    passes, and a green run stops meaning the working tree is green.
  */
  /*
    `apps/` is ignored because this config is the *web* app's — jsdom
    environment, next/jest transform, React 18 types. The Expo client runs
    React 19 under jest-expo and needs its own runner; discovering that as a
    wall of transform errors in this suite would teach nobody anything.
  */
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.claude/worktrees/',
    '<rootDir>/apps/',
  ],
  collectCoverageFrom: [
    'lib/**/*.{js,jsx,ts,tsx}',
    'app/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
}

module.exports = createJestConfig(customJestConfig)
