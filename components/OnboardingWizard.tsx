'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader as Loader2, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, X, Upload, Image as ImageIcon } from 'lucide-react';
import { logger } from '@crewchief/core/logger';
import { queryClient } from '@crewchief/core/query-client';
import { createVehicle, updateVehiclePowertrain, fetchPowertrainOptions, uploadVehiclePhoto } from '@/app/actions';
import { detectUncertainPowertrainFields } from '@crewchief/core/vehicle-utils';
import PowertrainSelector from '@/components/PowertrainSelector';
import type { PowertrainUncertainty } from '@crewchief/core/types';

interface OnboardingWizardProps {
  vehicleData: {
    vin: string;
    year: number;
    make: string;
    model: string;
    trim: string;
  };
}

const STEP_LABELS = ['Vehicle', 'Powertrain', 'Mileage', 'Ownership', 'Performance'];

/**
 * Progress through the wizard.
 *
 * ── Two presentations, because the rail does not survive a phone ────────────
 *
 * R7: five 32px circles with `whitespace-nowrap` labels beneath them. Below
 * about 420px "Powertrain" and "Performance" are wider than their circles, so
 * the labels overlap each other and the rail reads as damage rather than as
 * progress.
 *
 * **The dotted rail is a desktop affordance, not a small one.** Shrinking it
 * would keep a decoration at the cost of legibility, so below `sm` it is
 * replaced outright by the two facts it was conveying — where you are and what
 * this step is — plus a progress bar. Above `sm` it is exactly as it was.
 */
function StepIndicator({ currentStep, totalSteps, labels }: { currentStep: number; totalSteps: number; labels: string[] }) {
  return (
    <>
      {/* Below sm. The same information, in a line that fits. */}
      <div className="sm:hidden mb-6">
        <p className="text-xs font-medium text-white/70">
          Step {currentStep} of {totalSteps}
          {labels[currentStep - 1] ? ` · ${labels[currentStep - 1]}` : ''}
        </p>
        <div
          className="mt-2 h-0.5 w-full rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={currentStep}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
        >
          <div
            className="h-0.5 rounded-full bg-cyan-500 transition-all duration-300"
            style={{ width: `${(currentStep / totalSteps) * 100}%` }}
          />
        </div>
      </div>

    <div className="hidden sm:flex items-center gap-0 mb-8">
      {Array.from({ length: totalSteps }).map((_, i) => {
        const stepNum = i + 1;
        const isCompleted = stepNum < currentStep;
        const isActive = stepNum === currentStep;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-200 ${
                isCompleted
                  ? 'bg-cyan-500 text-black'
                  : isActive
                  ? 'bg-cyan-400/10 border-2 border-cyan-400 text-cyan-400'
                  : 'bg-white/5 border border-white/15 text-white/50'
              }`}>
                {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : stepNum}
              </div>
              {labels[i] && (
                <span className={`text-xs mt-1.5 font-medium whitespace-nowrap ${
                  isActive ? 'text-white/80' : isCompleted ? 'text-info/70' : 'text-white/50'
                }`}>
                  {labels[i]}
                </span>
              )}
            </div>
            {i < totalSteps - 1 && (
              <div className={`h-px flex-1 mx-2 mb-5 transition-all duration-300 ${isCompleted ? 'bg-cyan-500/60' : 'bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}

export default function OnboardingWizard({ vehicleData }: OnboardingWizardProps) {
  const router = useRouter();

  /**
   * Leave onboarding for the new vehicle's dashboard.
   *
   * The invalidation is the point, and it is not optional. `useMyVehicles`
   * caches the garage under `['vehicles','mine',userId]` with a five-minute
   * staleTime. Nothing here wrote to that cache, so a user who had already
   * loaded the garage — which every new user has, because an empty garage is
   * what sends them to onboarding — went back to it after adding their first
   * car and was told **"Your Garage is Empty"**. The vehicle was fine. The
   * list was five minutes stale.
   *
   * That is the worst possible moment for it: the first thing the product
   * asks you to do, appearing to have silently failed. Reported 30 Jul.
   *
   * Both exits from this wizard go through here so the two cannot drift —
   * the same second-implementation problem that produced the dead
   * `setQueryData(['vehicles'])` in VehicleCard, fixed the same morning.
   */
  const goToDashboard = (vehicleId: string) => {
    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    router.push(`/dashboard/${vehicleId}`);
  };
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showClarificationStep, setShowClarificationStep] = useState(false);
  const [uncertaintyData, setUncertaintyData] = useState<PowertrainUncertainty | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [powertrainReady, setPowertrainReady] = useState(false);
  const [powertrainSkipped, setPowertrainSkipped] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const processPhotoFile = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please select a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    setError('');
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processPhotoFile(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processPhotoFile(file);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const [formData, setFormData] = useState({
    year: vehicleData.year,
    make: vehicleData.make,
    model: vehicleData.model,
    trim: vehicleData.trim,
    color: '',
    engine_type: '',
    transmission_type: '',
    drivetrain: '',
    current_mileage: '',
    avg_miles_per_month: '',
    ownership_objective: '',
    ownership_details: '',
    performance_mindedness: 'stock' as 'stock' | 'mild' | 'aggressive',
    driving_style: '',
    clarified_engine: '',
    clarified_transmission: '',
    clarified_drivetrain: '',
  });

  useEffect(() => {
    let cancelled = false;
    fetchPowertrainOptions(vehicleData.year, vehicleData.make, vehicleData.model, vehicleData.trim).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) {
        const allSingle =
          result.data.engine_options.length <= 1 &&
          result.data.transmission_options.length <= 1 &&
          result.data.drivetrain_options.length <= 1;

        if (allSingle) {
          if (result.data.engine_options.length === 1) {
            setFormData(prev => ({ ...prev, engine_type: result.data!.engine_options[0] }));
          }
          if (result.data.transmission_options.length === 1) {
            setFormData(prev => ({ ...prev, transmission_type: result.data!.transmission_options[0] }));
          }
          if (result.data.drivetrain_options.length === 1) {
            setFormData(prev => ({ ...prev, drivetrain: result.data!.drivetrain_options[0] }));
          }
          setPowertrainSkipped(true);
        }
        setPowertrainReady(true);
      } else {
        setPowertrainSkipped(true);
        setPowertrainReady(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setPowertrainSkipped(true);
        setPowertrainReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [vehicleData.year, vehicleData.make, vehicleData.model, vehicleData.trim]);

  const updateFormData = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const totalSteps = showClarificationStep ? (powertrainSkipped ? 5 : 6) : (powertrainSkipped ? 4 : 5);

  const handleNext = () => {
    if (step === 1) {
      if (!formData.color) {
        setError('Please enter the vehicle color');
        return;
      }
      if (!powertrainReady) {
        setError('Please wait while we check available configurations...');
        return;
      }
      setError('');
      setStep(2);
      return;
    }
    if (step === 2 && !powertrainSkipped) {
      const needsEngine = !formData.engine_type;
      const needsTransmission = !formData.transmission_type;
      const needsDrivetrain = !formData.drivetrain;
      if (needsEngine || needsTransmission || needsDrivetrain) {
        setError('Please select all powertrain options');
        return;
      }
    }
    const mileageStep = powertrainSkipped ? 2 : 3;
    if (step === mileageStep && (!formData.current_mileage || !formData.avg_miles_per_month)) {
      setError('Both mileage fields are required');
      return;
    }
    const ownershipStep = powertrainSkipped ? 3 : 4;
    if (step === ownershipStep && !formData.ownership_objective) {
      setError('Please select an ownership objective');
      return;
    }
    setError('');
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const performanceStep = powertrainSkipped ? 4 : 5;
  const clarificationStep = powertrainSkipped ? 5 : 6;
  const mileageStep = powertrainSkipped ? 2 : 3;
  const ownershipStep = powertrainSkipped ? 3 : 4;

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    const usageProfile = `${formData.avg_miles_per_month} miles/month`;
    const objectiveText = formData.ownership_details
      ? `${formData.ownership_objective} - ${formData.ownership_details}`
      : formData.ownership_objective;

    const result = await createVehicle({
      vin: vehicleData.vin,
      year: formData.year,
      make: formData.make,
      model: formData.model,
      trim: formData.trim,
      color: formData.color,
      engine_type: formData.engine_type || null,
      transmission_type: formData.transmission_type || null,
      drivetrain: formData.drivetrain || null,
      current_mileage: parseInt(formData.current_mileage) || 0,
      ownership_objective: objectiveText,
      usage_profile: usageProfile,
      avg_miles_per_month: parseInt(formData.avg_miles_per_month) || 0,
      performance_mindedness: formData.performance_mindedness,
      driving_style: formData.driving_style,
    });

    if (!result.success) {
      setError(result.error || 'Failed to save vehicle');
      setLoading(false);
      return;
    }

    setVehicleId(result.vehicleId!);

    if (photoFile) {
      const photoData = new FormData();
      photoData.append('file', photoFile);
      photoData.append('vehicleId', result.vehicleId!);
      const photoResult = await uploadVehiclePhoto(photoData);
      if (!photoResult.success) {
        logger.error('ONBOARDING:PHOTO_UPLOAD', new Error(photoResult.error || 'Photo upload failed'));
      }
    }

    /*
      The user is done. Everything below this point used to run first.

      Measured 28 Jul: the research call alone is ~23s, the health summary is a
      second model call, and there was a hardcoded 2s pause on top — all before
      the user reached their garage. None of it is needed to own a car. The
      dashboard now calls `enrichVehicle` when it sees research_status
      'pending', so the work is owned by a request that is actually waiting for
      it rather than abandoned on a serverless platform (§11).

      The powertrain clarification stays, but it now runs against the VIN
      decode rather than the research. That is both faster and more truthful:
      NHTSA gave us engine, displacement and drivetrain in ~0.6s, and asking
      the user to confirm what the decode already knows never needed a model
      call in between.
    */
    const uncertainty = detectUncertainPowertrainFields(
      formData.engine_type,
      formData.transmission_type,
      formData.drivetrain
    );

    if (uncertainty.hasUncertainty) {
      setUncertaintyData(uncertainty);
      setShowClarificationStep(true);
      setLoading(false);
      setStep(clarificationStep);
      return;
    }

    goToDashboard(result.vehicleId);
  };

  const handleClarificationSubmit = async () => {
    if (!vehicleId || !uncertaintyData) {
      setError('Missing required data');
      return;
    }

    setLoading(true);
    setError('');

    const updates: Record<string, string> = {};

    if (uncertaintyData.uncertainFields.engine && formData.clarified_engine) {
      updates.engine_type = formData.clarified_engine;
    }

    if (uncertaintyData.uncertainFields.transmission && formData.clarified_transmission) {
      updates.transmission_type = formData.clarified_transmission;
    }

    if (uncertaintyData.uncertainFields.drivetrain && formData.clarified_drivetrain) {
      updates.drivetrain = formData.clarified_drivetrain;
    }

    if (Object.keys(updates).length === 0) {
      setError('Please select at least one specification');
      setLoading(false);
      return;
    }

    const updateResult = await updateVehiclePowertrain(vehicleId, updates as { engine_type?: string; transmission_type?: string; drivetrain?: string });

    if (!updateResult.success) {
      setError(updateResult.error || 'Failed to update specifications');
      setLoading(false);
      return;
    }

    // Same reasoning as the main path: the vehicle exists and the user has
    // told us what we needed. Enrichment belongs to the dashboard.
    goToDashboard(vehicleId);
  };

  const getStepTitle = () => {
    if (step === 1) return 'Confirm Vehicle Details';
    if (!powertrainSkipped && step === 2) return 'Powertrain Selection';
    if (step === mileageStep) return 'Driving Habits';
    if (step === ownershipStep) return 'Ownership Objectives';
    if (step === performanceStep) return 'Performance Mindset';
    if (step === clarificationStep) return 'Clarify Specifications';
    return '';
  };

  const getStepDescription = () => {
    if (step === 1) return 'Verify the information we decoded from your VIN';
    if (!powertrainSkipped && step === 2) return 'Select the factory configuration that matches your vehicle';
    if (step === mileageStep) return 'Tell us about your typical driving patterns';
    if (step === ownershipStep) return 'What are your plans for this vehicle?';
    if (step === performanceStep) return 'How do you approach modifications and upgrades?';
    if (step === clarificationStep) return 'Select the correct configuration for your vehicle';
    return '';
  };

  const displayLabels = powertrainSkipped
    ? ['Vehicle', 'Mileage', 'Ownership', 'Performance']
    : STEP_LABELS;

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-info-wash border border-info-border flex items-center justify-center">
              <span className="text-info font-bold text-sm">C</span>
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">CrewChief</span>
          </div>
          <p className="text-white/50 text-sm">Vehicle Setup</p>
        </div>

        <div className="glass-panel rounded-2xl p-5 sm:p-8">
          <StepIndicator
            currentStep={step}
            totalSteps={powertrainSkipped ? 4 : 5}
            labels={displayLabels}
          />

          <div className="mb-6">
            <h2 className="text-xl font-bold text-white mb-1">{getStepTitle()}</h2>
            <p className="text-sm text-white/50">{getStepDescription()}</p>
          </div>

          {step === 1 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Year</Label>
                  <Input
                    type="number"
                    value={formData.year}
                    onChange={(e) => updateFormData('year', parseInt(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Make</Label>
                  <Input
                    value={formData.make}
                    onChange={(e) => updateFormData('make', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Model</Label>
                <Input
                  value={formData.model}
                  onChange={(e) => updateFormData('model', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Trim <span className="text-white/50 normal-case font-normal">(optional)</span></Label>
                <Input
                  value={formData.trim}
                  onChange={(e) => updateFormData('trim', e.target.value)}
                  placeholder="e.g., LX, Sport, Limited"
                />
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Color <span className="text-red-400">*</span></Label>
                <Input
                  value={formData.color}
                  onChange={(e) => updateFormData('color', e.target.value)}
                  placeholder="e.g., Black, Silver, Red"
                  required
                />
                <p className="text-xs text-white/50 mt-1.5">This helps us find the right vehicle image</p>
              </div>

              {!powertrainReady && (
                <div className="flex items-center gap-3 p-3.5 bg-info-wash border border-info-border rounded-xl">
                  <div className="w-4 h-4 border-2 border-info-border border-t-info rounded-full animate-spin flex-shrink-0" />
                  <p className="text-sm text-info/80">Checking available configurations...</p>
                </div>
              )}

              {powertrainReady && powertrainSkipped && (
                <div className="flex items-center gap-3 p-3.5 bg-green-500/8 border border-green-400/20 rounded-xl">
                  <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                  <p className="text-sm text-green-300/80">Configuration detected automatically</p>
                </div>
              )}

              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">
                  Vehicle Photo <span className="text-white/50 normal-case font-normal">(optional)</span>
                </Label>
                <p className="text-xs text-white/50 mb-3">Upload your own photo or we&apos;ll find one automatically</p>

                {photoPreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/12 bg-black/30">
                    <img
                      src={photoPreview}
                      alt="Vehicle preview"
                      className="w-full h-48 object-contain"
                    />
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="absolute top-2 right-2 p-1.5 bg-black/70 hover:bg-black/90 rounded-full text-white/70 hover:text-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    className={`flex flex-col items-center justify-center h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ${
                      isDragging
                        ? 'border-cyan-400/70 bg-cyan-400/10 scale-[1.01]'
                        : 'border-white/15 hover:border-cyan-400/40 hover:bg-white/3'
                    }`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    <div className={`flex flex-col items-center gap-2 transition-colors ${isDragging ? 'text-cyan-400' : 'text-white/50'}`}>
                      {isDragging ? (
                        <>
                          <ImageIcon className="h-8 w-8" />
                          <span className="text-sm font-medium">Drop your photo here</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-7 w-7" />
                          <span className="text-sm font-medium">Click to upload or drag and drop</span>
                          <span className="text-xs text-white/50">JPEG, PNG, or WebP up to 5MB</span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {!powertrainSkipped && step === 2 && (
            <div className="space-y-4">
              <PowertrainSelector
                year={formData.year}
                make={formData.make}
                model={formData.model}
                trim={formData.trim}
                engineType={formData.engine_type}
                transmissionType={formData.transmission_type}
                drivetrain={formData.drivetrain}
                onEngineChange={(v) => updateFormData('engine_type', v)}
                onTransmissionChange={(v) => updateFormData('transmission_type', v)}
                onDrivetrainChange={(v) => updateFormData('drivetrain', v)}
              />
            </div>
          )}

          {step === mileageStep && (
            <div className="space-y-6">
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Current Odometer Reading <span className="text-red-400">*</span></Label>
                <Input
                  type="number"
                  placeholder="e.g., 45000"
                  value={formData.current_mileage}
                  onChange={(e) => updateFormData('current_mileage', e.target.value)}
                  required
                />
                <p className="text-xs text-white/50 mt-1.5">Enter total miles on your vehicle</p>
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Average Miles Per Month <span className="text-red-400">*</span></Label>
                <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-4">
                  {[500, 1000, 1500, 2000].map((miles) => (
                    <button
                      key={miles}
                      type="button"
                      onClick={() => updateFormData('avg_miles_per_month', miles.toString())}
                      className={`px-3 py-2.5 rounded-lg border transition-all text-sm font-medium ${
                        formData.avg_miles_per_month === miles.toString()
                          ? 'bg-cyan-400/10 text-cyan-300 border-cyan-400/40'
                          : 'border-white/12 bg-white/5 text-white/60 hover:bg-white/8 hover:border-white/20'
                      }`}
                    >
                      {miles}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  placeholder="Or enter custom amount"
                  value={formData.avg_miles_per_month}
                  onChange={(e) => updateFormData('avg_miles_per_month', e.target.value)}
                />
              </div>
            </div>
          )}

          {step === ownershipStep && (
            <div className="space-y-5">
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3 block">What are your plans for this vehicle?</Label>
                <RadioGroup
                  value={formData.ownership_objective}
                  onValueChange={(value) => updateFormData('ownership_objective', value)}
                  className="space-y-2"
                >
                  {[
                    { value: 'Keep forever', label: 'Keep forever', desc: 'This is my long-term vehicle' },
                    { value: 'Sell in 1-2 years', label: 'Sell in 1-2 years', desc: 'Planning to upgrade soon' },
                    { value: 'Sell in 3-5 years', label: 'Sell in 3-5 years', desc: 'Medium-term ownership' },
                    { value: 'Undecided', label: 'Undecided', desc: "I'll see how it goes" },
                  ].map(({ value, label, desc }) => (
                    <div
                      key={value}
                      className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
                        formData.ownership_objective === value
                          ? 'bg-cyan-400/10 border-cyan-400/35'
                          : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/15'
                      }`}
                      onClick={() => updateFormData('ownership_objective', value)}
                    >
                      <RadioGroupItem value={value} id={`ownership-${value}`} className="border-white/30" />
                      <Label htmlFor={`ownership-${value}`} className="flex-1 cursor-pointer">
                        <div className="font-medium text-white text-sm">{label}</div>
                        <div className="text-xs text-white/50 mt-0.5">{desc}</div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Additional context <span className="text-white/50 normal-case font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="e.g., Planning to pass it down to my kid, Need reliability for long commute..."
                  value={formData.ownership_details}
                  onChange={(e) => updateFormData('ownership_details', e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          {step === performanceStep && (
            <div className="space-y-5">
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3 block">Modifications</Label>
                {/*
                  ── Two options, not three ────────────────────────────────────

                  This asked for a level — stock, mild, or aggressive — and a
                  level is an end state. David, 7 Aug: *"I don't like the idea
                  of end states anymore. It's a continuum. There's almost always
                  something more you can do."* The build dial shows where a car
                  sits now, so nobody has to declare where they intend to stop
                  in the first sixty seconds of using the product.

                  What is left is the only question that changes anything: does
                  this person want the surface at all.

                  ⚠ **`performance_mindedness` is a Postgres enum**
                  `('stock','mild','aggressive')`, so "yes" is stored as `mild`
                  rather than a truer word — a new value needs `ALTER TYPE`, and
                  a migration is not worth spending on a label. `mild` now means
                  *interested*; `aggressive` is legacy and read-only. Nothing
                  branches on the difference any more: `showsModifications` is
                  the whole of it.
                */}
                <RadioGroup
                  value={formData.performance_mindedness}
                  onValueChange={(value) => updateFormData('performance_mindedness', value)}
                  className="space-y-2"
                >
                  {[
                    { value: 'mild', label: 'Yes, show me modifications', desc: 'A running list of what this car could have done next' },
                    { value: 'stock', label: 'Not interested', desc: 'Keep it factory — you can turn this on later' },
                  ].map(({ value, label, desc }) => (
                    <div
                      key={value}
                      className={`flex items-center gap-3 p-4 border rounded-xl cursor-pointer transition-all ${
                        formData.performance_mindedness === value
                          ? 'bg-cyan-400/10 border-cyan-400/35'
                          : 'border-white/10 bg-white/3 hover:bg-white/5 hover:border-white/15'
                      }`}
                      onClick={() => updateFormData('performance_mindedness', value)}
                    >
                      <RadioGroupItem value={value} id={`perf-${value}`} className="border-white/30" />
                      <Label htmlFor={`perf-${value}`} className="flex-1 cursor-pointer">
                        <div className="font-medium text-white text-sm">{label}</div>
                        <div className="text-xs text-white/50 mt-0.5">{desc}</div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div>
                <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1.5 block">Driving Style <span className="text-white/50 normal-case font-normal">(optional)</span></Label>
                <Textarea
                  placeholder="e.g., Mostly highway cruising, Spirited weekend drives, Daily commuter..."
                  value={formData.driving_style}
                  onChange={(e) => updateFormData('driving_style', e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          {step === clarificationStep && uncertaintyData && (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-4 bg-info-wash border border-info-border rounded-xl">
                <div className="w-5 h-5 rounded-full bg-info-wash border border-info-border flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-info text-xs font-bold">i</span>
                </div>
                <p className="text-sm text-info/80 leading-relaxed">
                  We found multiple possible configurations for your vehicle. Please select the correct options.
                </p>
              </div>

              {uncertaintyData.uncertainFields.engine && (
                <div>
                  <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3 block">Engine Type</Label>
                  <RadioGroup
                    value={formData.clarified_engine}
                    onValueChange={(value) => updateFormData('clarified_engine', value)}
                    className="space-y-2"
                  >
                    {uncertaintyData.uncertainFields.engine.options?.map((option, idx) => (
                      <div key={idx} className={`flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${
                        formData.clarified_engine === option ? 'bg-cyan-400/10 border-cyan-400/35' : 'border-white/10 bg-white/3 hover:bg-white/5'
                      }`}
                        onClick={() => updateFormData('clarified_engine', option)}
                      >
                        <RadioGroupItem value={option} id={`engine-${idx}`} className="border-white/30" />
                        <Label htmlFor={`engine-${idx}`} className="flex-1 cursor-pointer text-white text-sm">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}

              {uncertaintyData.uncertainFields.transmission && (
                <div>
                  <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3 block">Transmission Type</Label>
                  <RadioGroup
                    value={formData.clarified_transmission}
                    onValueChange={(value) => updateFormData('clarified_transmission', value)}
                    className="space-y-2"
                  >
                    {uncertaintyData.uncertainFields.transmission.options?.map((option, idx) => (
                      <div key={idx} className={`flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${
                        formData.clarified_transmission === option ? 'bg-cyan-400/10 border-cyan-400/35' : 'border-white/10 bg-white/3 hover:bg-white/5'
                      }`}
                        onClick={() => updateFormData('clarified_transmission', option)}
                      >
                        <RadioGroupItem value={option} id={`transmission-${idx}`} className="border-white/30" />
                        <Label htmlFor={`transmission-${idx}`} className="flex-1 cursor-pointer text-white text-sm">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}

              {uncertaintyData.uncertainFields.drivetrain && (
                <div>
                  <Label className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-3 block">Drivetrain</Label>
                  <RadioGroup
                    value={formData.clarified_drivetrain}
                    onValueChange={(value) => updateFormData('clarified_drivetrain', value)}
                    className="space-y-2"
                  >
                    {uncertaintyData.uncertainFields.drivetrain.options?.map((option, idx) => (
                      <div key={idx} className={`flex items-center gap-3 p-3.5 border rounded-xl cursor-pointer transition-all ${
                        formData.clarified_drivetrain === option ? 'bg-cyan-400/10 border-cyan-400/35' : 'border-white/10 bg-white/3 hover:bg-white/5'
                      }`}
                        onClick={() => updateFormData('clarified_drivetrain', option)}
                      >
                        <RadioGroupItem value={option} id={`drivetrain-${idx}`} className="border-white/30" />
                        <Label htmlFor={`drivetrain-${idx}`} className="flex-1 cursor-pointer text-white text-sm">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-400/25 rounded-xl">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/*
            Stacked and full-width below `sm`, side by side above it. Two
            buttons sharing a narrow row leaves "Back" wide enough to hit by
            accident while reaching for the primary action, which on the last
            step is the one that creates the car.

            `flex-col-reverse` so the primary keeps its position in the DOM —
            and therefore in the tab order and for a screen reader — while
            appearing above "Back" on a phone, where the thumb reaches the
            bottom first.
          */}
          <div className="flex flex-col-reverse gap-3 mt-7 sm:flex-row">
            {step > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                disabled={loading}
                className="text-white/50 hover:text-white hover:bg-white/8 border border-white/10"
              >
                Back
              </Button>
            )}
            {step < performanceStep ? (
              <Button
                type="button"
                onClick={handleNext}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                disabled={loading || (step === 1 && !powertrainReady)}
              >
                {step === 1 && !powertrainReady ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  'Continue'
                )}
              </Button>
            ) : step === performanceStep ? (
              <Button
                type="button"
                onClick={handleSubmit}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                disabled={loading || !formData.ownership_objective}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Researching Vehicle...
                  </span>
                ) : (
                  'Complete Setup'
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleClarificationSubmit}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Updating Specifications...
                  </span>
                ) : (
                  'Confirm & Continue'
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
