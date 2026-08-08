'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { Car, Eye, EyeOff, Loader as Loader2, CircleCheck as CheckCircle2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createBrowserSupabaseClient } from '@/lib/supabase';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const passwordStrength = password.length === 0 ? null
    : password.length < 6 ? 'weak'
    : password.length < 10 ? 'fair'
    : 'strong';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      const client = createBrowserSupabaseClient();
      const { data, error: signUpError } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      /*
       * Supabase returns a session only when email confirmation is switched
       * off for the project. When it is on, we get a user and no session —
       * which is the signal that the address has not been proven yet.
       *
       * This previously called signInWithPassword() in that branch, handing
       * out a full session anyway. That defeated verification entirely: you
       * could register any address you did not control and be signed in as
       * its owner. Do not reintroduce that fallback.
       */
      if (data.session) {
        /*
          Phase 2.97c. Attach any scan this browser made before signing up, so
          the answer they just liked is waiting in the account rather than
          needing a second photograph.

          Awaited but never allowed to block the redirect on failure: the
          account exists and they are signed in, and stranding them on the
          signup form because a claim failed would trade the whole conversion
          for a nicety. `/auth/callback` covers the verification path.
        */
        try {
          await fetch('/api/v1/front-door/claim', { method: 'POST' });
        } catch {
          // Deliberately silent. The scan stays unclaimed; the signup succeeded.
        }

        setSuccess(true);
        setTimeout(() => { router.push('/onboard'); router.refresh(); }, 1000);
        return;
      }

      setAwaitingVerification(true);
      setLoading(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendState('sending');
    setError(null);
    try {
      const client = createBrowserSupabaseClient();
      const { error: resendError } = await client.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      // Supabase rate limits this server-side; surface its message rather
      // than inventing our own cooldown.
      setResendState(resendError ? 'error' : 'sent');
      if (resendError) setError(resendError.message);
    } catch {
      setResendState('error');
      setError('Could not resend the email. Please try again shortly.');
    }
  }

  if (awaitingVerification) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim"
      >
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <Mail className="h-14 w-14 text-info mx-auto mb-5" aria-hidden="true" />
            <h2 className="text-2xl font-bold text-white mb-3">Confirm your email</h2>
            <p className="text-white/55 text-sm leading-relaxed">
              We sent a confirmation link to{' '}
              <span className="text-white font-medium break-all">{email}</span>.
              Open it to finish setting up your garage.
            </p>

            <div className="mt-7 pt-6 border-t border-white/10">
              {resendState === 'sent' ? (
                <p className="text-sm text-health-good">
                  Sent again — check your inbox and spam folder.
                </p>
              ) : (
                <>
                  <p className="text-xs text-white/50 mb-3">Didn&apos;t get it?</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResend}
                    disabled={resendState === 'sending'}
                    className="border-white/15 text-white/80 hover:text-white"
                  >
                    {resendState === 'sending' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" aria-hidden="true" />
                        Sending…
                      </>
                    ) : (
                      'Resend confirmation email'
                    )}
                  </Button>
                </>
              )}

              {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
            </div>

            <p className="text-xs text-white/50 mt-6">
              Already confirmed?{' '}
              <Link href="/login" className="text-info hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim"
      >
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto mb-5" />
            <h2 className="text-2xl font-bold text-white mb-3">Account created!</h2>
            <p className="text-white/55 text-sm leading-relaxed">
              Logging you in and setting up your garage...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim"
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 group mb-6">
            <Car className="h-7 w-7 text-white" />
            <span className="text-xl font-semibold text-white tracking-tight">CrewChief</span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
          <p className="text-white/50 text-sm">Add a vehicle and get its full dossier &mdash; plus an AI consultant that knows your car.</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <form onSubmit={handleSubmit} noValidate suppressHydrationWarning className="space-y-6">
            <div className="space-y-2 mb-8">
              <label htmlFor="email" className="text-white/70 text-sm font-medium block">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                suppressHydrationWarning
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-white/70 text-sm font-medium block">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  autoComplete="new-password"
                  suppressHydrationWarning
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
              {passwordStrength && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex gap-1 flex-1">
                    {['weak', 'fair', 'strong'].map((level, i) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          i < (['weak', 'fair', 'strong'].indexOf(passwordStrength) + 1)
                            ? passwordStrength === 'weak' ? 'bg-red-500'
                              : passwordStrength === 'fair' ? 'bg-yellow-500'
                              : 'bg-emerald-500'
                            : 'bg-white/10'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-xs ${
                    passwordStrength === 'weak' ? 'text-red-400'
                    : passwordStrength === 'fair' ? 'text-yellow-400'
                    : 'text-emerald-400'
                  }`}>
                    {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1)}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-white/70 text-sm font-medium block">
                Confirm Password
              </label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                required
                autoComplete="new-password"
                suppressHydrationWarning
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl transition-all"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Account'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/[0.08] text-center">
            <p className="text-white/50 text-sm">
              Already have an account?{' '}
              <Link href="/login" className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium">
                Sign in
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-white/50 hover:text-white/50 text-xs transition-colors">
              Or try the demo without an account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
