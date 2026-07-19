'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader as Loader2, Car, ArrowLeft } from 'lucide-react';
import { decodeVIN } from '../actions';
import OnboardingWizard from '@/components/OnboardingWizard';

export default function OnboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromDemo = searchParams.get('from') === 'demo';
  const garageHref = fromDemo ? '/demo' : '/garage';

  const [vin, setVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vehicleData, setVehicleData] = useState<any>(null);
  const [showWizard, setShowWizard] = useState(false);

  const handleVINSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await decodeVIN(vin);

    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Failed to decode VIN');
      if (result.vehicleId) {
        setTimeout(() => {
          router.push(`/dashboard/${result.vehicleId}`);
        }, 2000);
      }
      return;
    }

    setVehicleData(result.vehicle);
    setShowWizard(true);
  };

  if (showWizard && vehicleData) {
    return <OnboardingWizard vehicleData={vehicleData} />;
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 overflow-hidden">
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.88)), url('/dark-roomb.jpeg')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      <div className="relative z-10 w-full max-w-lg">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(garageHref)}
            className="text-white/50 hover:text-white hover:bg-white/8 gap-1.5 px-3"
          >
            <ArrowLeft className="h-4 w-4" />
            {fromDemo ? 'Back to Demo Garage' : 'Back to Garage'}
          </Button>
        </div>

        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 bg-cyan-500/15 rounded-2xl flex items-center justify-center border border-cyan-400/25">
              <Car className="h-10 w-10 text-cyan-400" />
            </div>
          </div>
          <h1 className="text-4xl font-semibold text-white mb-3 tracking-tight">
            Add Your Vehicle
          </h1>
          <p className="text-base text-white/55 max-w-sm mx-auto leading-relaxed">
            Enter your VIN to get started. We&apos;ll decode it and research your vehicle automatically.
          </p>
        </div>

        <div className="border border-white/10 rounded-2xl p-8 bg-white/4 backdrop-blur-xl">
          <form onSubmit={handleVINSubmit} className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="vin" className="text-sm font-medium text-white/80">
                  Vehicle Identification Number (VIN)
                </Label>
                <span className={`text-xs font-mono tabular-nums transition-colors ${vin.length === 17 ? 'text-green-400' : 'text-white/30'}`}>
                  {vin.length}/17
                </span>
              </div>
              <Input
                id="vin"
                placeholder="Enter 17-character VIN"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                maxLength={17}
                className="font-mono text-base h-12 bg-white/6 border-white/12 text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:bg-white/8 transition-colors"
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-white/40">
                Find your VIN on the driver&apos;s side dashboard or door jamb
              </p>
            </div>

            {error && (
              <Alert className="bg-red-500/10 border-red-400/30 text-red-300">
                <AlertDescription className="text-red-300">{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white h-12 text-sm font-semibold rounded-xl glow-cyan-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              disabled={loading || vin.length !== 17}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Decoding VIN...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/8">
            <p className="text-sm text-center text-white/40">
              Already have vehicles?{' '}
              <button
                className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                onClick={() => router.push(garageHref)}
              >
                {fromDemo ? 'Go to Demo Garage' : 'Go to Garage'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
