/**
 * Middleware route protection.
 *
 * @jest-environment node
 *
 * Requires the node environment: NextRequest extends the Web Request API,
 * which jsdom does not provide. Without this docblock the suite throws
 * `ReferenceError: Request is not defined` at import time and silently
 * contributes zero passing tests — which is exactly what it did until
 * task 0.10a.
 *
 * These assertions run against `resolveRoute` and `isProtectedRoute` imported
 * from the real `middleware.ts`. An earlier version of this file defined its
 * own `runMiddlewareLogic()` copy and tested that instead, so it stayed green
 * while the exported middleware was a no-op with an empty matcher. If the
 * policy is ever gutted again, these tests go red.
 */

import { NextRequest } from 'next/server';
import {
  resolveRoute,
  isProtectedRoute,
  PROTECTED_ROUTES,
  config as middlewareConfig,
} from '@/middleware';

const AUTH_COOKIE = 'sb-abc123-auth-token';

function decisionFor(pathname: string, isAuthenticated: boolean) {
  const request = new NextRequest(`http://localhost:3000${pathname}`);
  return resolveRoute({
    pathname,
    isAuthenticated,
    requestUrl: request.url,
  });
}

describe('Middleware: route protection', () => {
  describe('unauthenticated access to protected routes', () => {
    it('redirects /garage to /login with the redirect param', () => {
      const result = decisionFor('/garage', false);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/login');
        expect(result.location).toContain('redirect=%2Fgarage');
      }
    });

    it('redirects /dashboard/:id to /login preserving the full path', () => {
      const result = decisionFor('/dashboard/abc-123', false);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/login');
        expect(result.location).toContain('redirect=%2Fdashboard%2Fabc-123');
      }
    });

    it('redirects /consultant/:id to /login', () => {
      expect(decisionFor('/consultant/vehicle-id', false).type).toBe('redirect');
    });

    it('redirects /onboard to /login', () => {
      expect(decisionFor('/onboard', false).type).toBe('redirect');
    });

    it('redirects every declared protected route', () => {
      for (const route of PROTECTED_ROUTES) {
        expect(decisionFor(route, false).type).toBe('redirect');
      }
    });
  });

  describe('authenticated access to protected routes', () => {
    it('allows /garage', () => {
      expect(decisionFor('/garage', true).type).toBe('next');
    });

    it('allows /dashboard/:id', () => {
      expect(decisionFor('/dashboard/abc-123', true).type).toBe('next');
    });

    it('allows every declared protected route', () => {
      for (const route of PROTECTED_ROUTES) {
        expect(decisionFor(route, true).type).toBe('next');
      }
    });
  });

  describe('public routes', () => {
    it('allows unauthenticated access to /', () => {
      expect(decisionFor('/', false).type).toBe('next');
    });

    it('allows unauthenticated access to /demo — the public portfolio demo', () => {
      expect(decisionFor('/demo', false).type).toBe('next');
      expect(decisionFor('/demo/anything', false).type).toBe('next');
    });

    it('allows unauthenticated access to /login', () => {
      expect(decisionFor('/login', false).type).toBe('next');
    });

    it('allows unauthenticated access to /signup', () => {
      expect(decisionFor('/signup', false).type).toBe('next');
    });
  });

  describe('authenticated user on auth pages', () => {
    it('redirects away from /login to /garage', () => {
      const result = decisionFor('/login', true);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/garage');
      }
    });

    it('redirects away from /signup to /garage', () => {
      const result = decisionFor('/signup', true);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/garage');
      }
    });
  });

  describe('public demo paths', () => {
    // Regression: an earlier version of this middleware protected /dashboard
    // wholesale, so an anonymous visitor clicking a car on /demo was bounced
    // to /login. The demo is a live portfolio piece — it must stay reachable.
    const DEMO_ID = 'a1000000-0000-0000-0000-000000000001';

    it.each([
      `/dashboard/${DEMO_ID}`,
      `/consultant/${DEMO_ID}`,
      `/documents/${DEMO_ID}`,
      `/vehicle-info/${DEMO_ID}`,
    ])('allows anonymous access to %s', (path) => {
      expect(isProtectedRoute(path)).toBe(false);
      expect(decisionFor(path, false).type).toBe('next');
    });

    it('still protects the same sections for a non-demo vehicle', () => {
      const real = '/dashboard/d4e8b2a1-0000-4000-8000-000000000abc';
      expect(isProtectedRoute(real)).toBe(true);
      expect(decisionFor(real, false).type).toBe('redirect');
    });

    it('does not treat the section index as public', () => {
      expect(isProtectedRoute('/dashboard')).toBe(true);
    });
  });

  describe('isProtectedRoute', () => {
    it('matches a route exactly and as a path prefix', () => {
      expect(isProtectedRoute('/garage')).toBe(true);
      expect(isProtectedRoute('/garage/nested/deep')).toBe(true);
    });

    it('does not match on a bare string prefix', () => {
      // '/garages' must not be treated as under '/garage'.
      expect(isProtectedRoute('/garages')).toBe(false);
      expect(isProtectedRoute('/dashboards')).toBe(false);
    });

    it('leaves public routes unprotected', () => {
      expect(isProtectedRoute('/')).toBe(false);
      expect(isProtectedRoute('/demo')).toBe(false);
      expect(isProtectedRoute('/login')).toBe(false);
    });
  });

  describe('matcher wiring', () => {
    it('is not empty — an empty matcher disables middleware entirely', () => {
      expect(middlewareConfig.matcher.length).toBeGreaterThan(0);
    });

    it('covers every protected route', () => {
      for (const route of PROTECTED_ROUTES) {
        expect(
          middlewareConfig.matcher.some((m) => m.startsWith(route))
        ).toBe(true);
      }
    });

    it('does not match the public demo, which must stay anonymous', () => {
      expect(middlewareConfig.matcher.some((m) => m.startsWith('/demo'))).toBe(false);
    });
  });
});
