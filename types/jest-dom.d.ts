/**
 * Type registration for @testing-library/jest-dom's matchers.
 *
 * `jest.setup.js` imports the matchers at runtime, which is enough for Jest
 * but not for `tsc` — it has no reason to know that `expect` grew
 * `toBeInTheDocument`. That went unnoticed until Phase 2's onboarding work
 * added the repo's first `.tsx` test; every suite before it was pure logic.
 */
import '@testing-library/jest-dom';
