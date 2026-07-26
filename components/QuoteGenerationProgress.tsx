'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CircleCheck as CheckCircle2, Loader as Loader2, DollarSign, MapPin, Mail, Wrench, Zap } from 'lucide-react';

interface ServiceItem {
  id: string;
  description: string;
  category: string;
}

interface QuoteGenerationProgressProps {
  items: ServiceItem[];
  zipCode: string;
}

export function QuoteGenerationProgress({ items, zipCode }: QuoteGenerationProgressProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress((prev) => Math.min(prev + 2, 100));
    }, 150);

    const stepTimer = setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, 3));
    }, 2500);

    return () => {
      clearInterval(progressTimer);
      clearInterval(stepTimer);
    };
  }, []);

  const steps = [
    { label: 'Analyzing service items', icon: Wrench },
    { label: 'Checking regional labor rates', icon: MapPin },
    { label: 'Calculating cost estimates', icon: DollarSign },
    { label: 'Generating email draft', icon: Mail },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="flex justify-center"
        >
          <div className="relative">
            <Zap className="h-16 w-16 text-info" />
            <motion.div
              className="absolute inset-0 bg-info-wash rounded-full blur-xl"
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
        <h3 className="text-2xl font-bold text-info">Generating Your Quote</h3>
        <p className="text-slate-400">
          Analyzing {items.length} service {items.length === 1 ? 'item' : 'items'} for zip code {zipCode}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Overall Progress</span>
          <span className="text-info font-semibold">{Math.round(progress)}%</span>
        </div>
        <div className="h-2.5 bg-slate-800/80 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden animate-pulse-progress"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #06b6d4, #22d3ee, #67e8f9, #22d3ee)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s linear infinite, pulseProgress 1.8s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-400">Processing Steps</div>
        {steps.map((step, idx) => {
          const StepIcon = step.icon;
          const status = idx < currentStep ? 'complete' : idx === currentStep ? 'active' : 'pending';

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <Card
                className={`transition-all duration-300 ${
                  status === 'complete'
                    ? 'bg-green-900/20 border-green-400/30'
                    : status === 'active'
                    ? 'bg-cyan-400/10 border-cyan-400/40 shadow-lg shadow-cyan-500/10'
                    : 'bg-slate-900/30 border-slate-700/30'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {status === 'complete' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                      ) : status === 'active' ? (
                        <Loader2 className="h-5 w-5 text-info animate-spin" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-slate-600" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                      <StepIcon
                        className={`h-4 w-4 ${
                          status === 'complete'
                            ? 'text-green-400'
                            : status === 'active'
                            ? 'text-info'
                            : 'text-slate-500'
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          status === 'complete'
                            ? 'text-green-400'
                            : status === 'active'
                            ? 'text-info'
                            : 'text-slate-500'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {status === 'active' && (
                      <motion.div
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="flex-shrink-0"
                      >
                        {/* Status, not an action — informational, so info not
                            brand cyan. The progress-bar fill stays cyan. */}
                        <Badge variant="outline" className="border-info-border text-info text-xs">
                          Processing
                        </Badge>
                      </motion.div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-sm text-slate-400 italic"
      >
        Using AI to analyze market rates and regional pricing data...
      </motion.div>
    </div>
  );
}
