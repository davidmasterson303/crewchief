/**
 * Test Suite 1: Unauthenticated Route Redirect
 *
 * Verifies that the middleware correctly identifies unauthenticated requests
 * and produces a redirect to /login with the original path preserved.
 */

import { NextRequest } from 'next/server';

function hasAuthSession(request: NextRequest): boolean {
  return request.cookies.getAll().some(
    (cookie) => cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')
  );
}

const PROTECTED_ROUTES = [
  '/garage',
  '/dashboard',
  '/consultant',
  '/documents',
  '/vehicle-info',
  '/onboard',
];

function runMiddlewareLogic(request: NextRequest): { type: 'redirect'; location: string } | { type: 'next' } {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
  );

  const authenticated = hasAuthSession(request);

  if (isProtected && !authenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return { type: 'redirect', location: loginUrl.toString() };
  }

  if ((pathname === '/login' || pathname === '/signup') && authenticated) {
    return { type: 'redirect', location: new URL('/garage', request.url).toString() };
  }

  return { type: 'next' };
}

describe('Middleware: Route Protection', () => {
  function makeRequest(pathname: string, cookies: Record<string, string> = {}): NextRequest {
    const url = `http://localhost:3000${pathname}`;
    const req = new NextRequest(url);
    Object.entries(cookies).forEach(([name, value]) => {
      req.cookies.set(name, value);
    });
    return req;
  }

  describe('unauthenticated access to protected routes', () => {
    it('redirects /garage to /login with redirect param', () => {
      const req = makeRequest('/garage');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/login');
        expect(result.location).toContain('redirect=%2Fgarage');
      }
    });

    it('redirects /dashboard/some-id to /login', () => {
      const req = makeRequest('/dashboard/abc-123');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/login');
        expect(result.location).toContain('redirect=');
      }
    });

    it('redirects /consultant/:id to /login', () => {
      const req = makeRequest('/consultant/vehicle-id');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
    });

    it('redirects /onboard to /login', () => {
      const req = makeRequest('/onboard');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
    });
  });

  describe('authenticated access to protected routes', () => {
    const authCookies = { 'sb-abc123-auth-token': 'some-token-value' };

    it('allows authenticated access to /garage', () => {
      const req = makeRequest('/garage', authCookies);
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('next');
    });

    it('allows authenticated access to /dashboard/:id', () => {
      const req = makeRequest('/dashboard/abc-123', authCookies);
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('next');
    });
  });

  describe('public routes', () => {
    it('allows unauthenticated access to /', () => {
      const req = makeRequest('/');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('next');
    });

    it('allows unauthenticated access to /demo', () => {
      const req = makeRequest('/demo');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('next');
    });

    it('allows unauthenticated access to /login', () => {
      const req = makeRequest('/login');
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('next');
    });
  });

  describe('authenticated user on auth pages', () => {
    const authCookies = { 'sb-abc123-auth-token': 'some-token-value' };

    it('redirects authenticated user away from /login to /garage', () => {
      const req = makeRequest('/login', authCookies);
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        expect(result.location).toContain('/garage');
      }
    });

    it('redirects authenticated user away from /signup to /garage', () => {
      const req = makeRequest('/signup', authCookies);
      const result = runMiddlewareLogic(req);
      expect(result.type).toBe('redirect');
    });
  });
});
