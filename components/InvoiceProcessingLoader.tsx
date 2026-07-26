'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, FileText } from 'lucide-react';

interface InvoiceProcessingLoaderProps {
  isProcessing: boolean;
  fileName?: string;
}

const steps = [
  { label: 'Uploading file', duration: 2000 },
  { label: 'Analyzing content', duration: 2000 },
  { label: 'Extracting details', duration: 2500 },
  { label: 'Processing line items', duration: 2000 },
];

export default function InvoiceProcessingLoader({ isProcessing, fileName }: InvoiceProcessingLoaderProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isProcessing) {
      setCurrentStep(0);
      return;
    }

    const timer = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, steps[currentStep]?.duration || 2000);

    return () => clearInterval(timer);
  }, [isProcessing, currentStep]);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="mb-8">
        <div className="relative w-24 h-24 mx-auto">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/20 to-blue-400/20 rounded-full animate-pulse blur-xl" />

          <svg className="w-24 h-24 relative" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="docGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
            </defs>

            <g opacity="0.2">
              <rect x="20" y="15" width="60" height="75" rx="2" fill="url(#docGrad)" />
              <line x1="30" y1="30" x2="70" y2="30" stroke="url(#docGrad)" strokeWidth="2" />
              <line x1="30" y1="42" x2="70" y2="42" stroke="url(#docGrad)" strokeWidth="2" />
              <line x1="30" y1="54" x2="70" y2="54" stroke="url(#docGrad)" strokeWidth="2" />
            </g>

            <g className="animate-[spin_3s_linear_infinite]" style={{ transformOrigin: '50px 50px' }}>
              <circle cx="50" cy="50" r="40" fill="none" stroke="url(#docGrad)" strokeWidth="2" opacity="0.3" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="url(#docGrad)" strokeWidth="1.5" opacity="0.15" />
            </g>

            <g className="animate-[spin_2s_linear_infinite_reverse]" style={{ transformOrigin: '50px 50px' }}>
              <circle cx="50" cy="12" r="3" fill="url(#docGrad)" />
            </g>
          </svg>
        </div>
      </div>

      <div className="max-w-md w-full space-y-6">
        {fileName && (
          <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg border border-info-border">
            <FileText className="h-4 w-4 text-info flex-shrink-0" />
            <p className="text-sm text-slate-300 truncate">{fileName}</p>
          </div>
        )}

        <div className="space-y-3">
          {steps.map((step, index) => {
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;

            return (
              <div
                key={step.label}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                  isActive
                    ? 'bg-info-wash border border-info-border'
                    : isCompleted
                    ? 'bg-green-400/5 border border-green-400/20'
                    : 'bg-slate-800/30 border border-slate-700/30'
                }`}
              >
                <div className="flex-shrink-0">
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5 text-green-400 animate-pulse" />
                  ) : isActive ? (
                    <div className="relative w-5 h-5">
                      <div className="absolute inset-0 bg-info-wash rounded-full animate-ping" />
                      <div className="absolute inset-1 bg-cyan-400 rounded-full" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-slate-600" />
                  )}
                </div>
                <span
                  className={`text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-info'
                      : isCompleted
                      ? 'text-green-300'
                      : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
                {isActive && (
                  <div className="ml-auto flex gap-1">
                    <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-2 border-t border-slate-700/50">
          <p className="text-xs text-slate-400 text-center italic">
            This may take a moment while we analyze your invoice...
          </p>
        </div>
      </div>
    </div>
  );
}
