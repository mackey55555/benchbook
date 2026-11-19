/** 手元の Supabase を相手にした通しテスト用。jest-expo の通信の差し替えを避けるため、素の Node で動かす */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__integration__/**/*.itest.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
