'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Car, Eye, EyeOff, Loader as Loader2, CircleCheck as CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBrowserSupabaseClient } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    const client = createBrowserSupabaseClient();

    async function tryEstablishSession() {
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      if (accessToken && refreshToken && type === 'recovery') {
        try {
          const { error: sessionError } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) {
            setInvalidLink(true);
          } else {
            setSessionReady(true);
          }
        } catch {
          setInvalidLink(true);
        }
        return;
      }

      const { data: { session } } = await client.auth.getSession();
      if (session) {
        setSessionReady(true);
        return;
      }

      const timeout = setTimeout(() => setInvalidLink(true), 8000);

      const { data: { subscription } } = client.auth.onAuthStateChange((event: string) => {
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
          clearTimeout(timeout);
          setSessionReady(true);
          subscription.unsubscribe();
        }
      });

      return () => {
        clearTimeout(timeout);
        subscription.unsubscribe();
      };
    }

    tryEstablishSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      const { error: updateError } = await client.auth.updateUser({ password });

      setLoading(false);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
      setTimeout(() => { window.location.href = '/garage'; }, 2500);
    } catch {
      setLoading(false);
      setError('Something went wrong. Please try again.');
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim">
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto mb-5" />
            <h2 className="text-2xl font-bold text-white mb-3">Password updated</h2>
            <p className="text-white/55 text-sm">Redirecting you to your garage...</p>
          </div>
        </div>
      </div>
    );
  }

  if (invalidLink) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim">
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <Car className="h-10 w-10 text-white mx-auto mb-5" />
            <h2 className="text-xl font-bold text-white mb-3">Reset link expired</h2>
            <p className="text-white/55 text-sm mb-6">
              This link is invalid or has already been used. Request a new one below.
            </p>
            <Link href="/forgot-password">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 px-4 sm:px-6">
                Request New Link
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim">
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <Loader2 className="h-10 w-10 text-info mx-auto mb-5 animate-spin" />
            <p className="text-white/55 text-sm">Verifying reset link...</p>
            <p className="text-white/50 text-xs mt-3">
              If this takes too long,{' '}
              <Link href="/forgot-password" className="text-cyan-400 hover:text-cyan-300">
                request a new link
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 group mb-6">
            <Car className="h-7 w-7 text-white" />
            <span className="text-xl font-semibold text-white tracking-tight">CrewChief</span>
          </Link>
          <h1 className="text-2xl font-bold text-white mb-2">Set new password</h1>
          <p className="text-white/50 text-sm">Choose a strong password for your account</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white/70 text-sm font-medium">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  required
                  autoComplete="new-password"
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/60 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-white/70 text-sm font-medium">Confirm Password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                required
                autoComplete="new-password"
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update Password'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
