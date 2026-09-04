'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader as Loader2, ArrowLeft, CircleCheck as CheckCircle2 } from 'lucide-react';
import BrandLockup from '@/components/brand/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBrowserSupabaseClient } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const client = createBrowserSupabaseClient();
      const { error: resetError } = await client.auth.resetPasswordForEmail(email, { redirectTo });

      setLoading(false);

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setSent(true);
    } catch (err) {
      setLoading(false);
      setError('Something went wrong. Please try again.');
    }
  }

  if (sent) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 service-bay service-bay-dim"
      >
        <div className="w-full max-w-md text-center">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-10 backdrop-blur-xl">
            <CheckCircle2 className="h-14 w-14 text-info mx-auto mb-5" />
            <h2 className="display-serif text-3xl text-white mb-3">Check your email</h2>
            <p className="text-white/55 text-sm leading-relaxed mb-6">
              We sent a password reset link to <span className="text-white font-medium">{email}</span>.
              Follow the link to set a new password.
            </p>
            <Link href="/login">
              <Button variant="outline" className="border-white/15 text-white/70 hover:bg-white/5 rounded-xl h-10">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Sign In
              </Button>
            </Link>
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
          <Link href="/" className="inline-flex group mb-6">
            <BrandLockup width={200} />
          </Link>
          <h1 className="display-serif text-3xl text-white mb-2">Reset your password</h1>
          <p className="text-white/50 text-sm">Enter your email and we'll send a reset link</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white/70 text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Reset Link'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/8 text-center">
            <Link href="/login" className="inline-flex items-center gap-1.5 text-white/50 hover:text-white/60 text-sm transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
