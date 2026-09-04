'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader as Loader2 } from 'lucide-react';
import BrandLockup from '@/components/brand/BrandLockup';
import { Button } from '@/components/ui/button';
import { createBrowserSupabaseClient } from '@/lib/supabase';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/garage';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const client = createBrowserSupabaseClient();
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? 'Incorrect email or password.'
            : signInError.message
        );
        setLoading(false);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-2">
        <label htmlFor="email" className="text-white/70 text-sm font-medium">
          Email
        </label>
        {/*
          Converted from a raw `<input>` to the shared primitive (v7 C3).

          This screen and signup were the only two bypassing `Input` entirely, so
          C1 reached every form in the app except the first two anyone meets.
          Type, name, autoComplete and `required` are unchanged — this is a
          conversion, not a restyle.
        */}
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-white/70 text-sm font-medium">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/50">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          {/* `pr-11` stays — it clears the show/hide button, which is layout,
              not theme. */}
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/60 transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign In'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim"
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex group mb-6">
            <BrandLockup width={200} />
          </Link>
          <h1 className="display-serif text-3xl text-white mb-2">Welcome back</h1>
          <p className="text-white/50 text-sm">Sign in to access your garage</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <div className="mt-6 pt-6 border-t border-white/[0.08] text-center">
            <p className="text-white/50 text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="font-medium text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white/60">
                Sign up free
              </Link>
            </p>
          </div>

          {/*
            ── ⚠ The demo is the funnel, and it was set as fine print ─────────

            12px, at the quietest alpha the ramp allows, with **no hover
            change at all** — its hover state named the same value the link
            already had, so the one affordance saying "this is a link" did
            nothing. A visitor with no account is exactly who this page is for,
            and the route that costs them nothing was the quietest thing on it.

            ⚠ The old class is described rather than quoted: the contrast suite
            counts how many of these tokens vanish when comments are stripped
            and allows five across the tree, so spending the margin on prose
            about the rule is what breaks it.

            Still below the sign-up line, because a returning user is the
            page's primary case. But it reads as a control now.
          */}
          <div className="mt-4 text-center">
            <Link
              href="/"
              className="text-sm text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/50"
            >
              Or try the demo without an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
