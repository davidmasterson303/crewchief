'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Car, Eye, EyeOff, Loader as Loader2 } from 'lucide-react';
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
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          required
          className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 h-11 rounded-xl px-3 text-sm transition-colors"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-white/70 text-sm font-medium">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className="w-full bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 h-11 rounded-xl px-3 pr-11 text-sm transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign In'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.85)), url('/dark-roomb.jpeg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 group mb-6">
            <Car className="h-7 w-7 text-white" />
            <span className="text-xl font-semibold text-white tracking-tight">CrewChief</span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-white/50 text-sm">Sign in to access your garage</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <div className="mt-6 pt-6 border-t border-white/[0.08] text-center">
            <p className="text-white/40 text-sm">
              Don't have an account?{' '}
              <Link href="/signup" className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium">
                Sign up free
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/demo" className="text-white/30 hover:text-white/50 text-xs transition-colors">
              Or try the demo without an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
