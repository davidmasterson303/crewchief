'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Gauge, Rocket } from 'lucide-react';
import { updatePerformanceGoal } from '@/app/actions';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@/lib/query-invalidation';

interface PerformanceGoalSelectorProps {
  vehicleId: string;
  currentGoal: 'mild' | 'moderate' | 'aggressive';
  onGoalChange?: (newGoal: 'mild' | 'moderate' | 'aggressive') => void;
}

const GOALS = [
  {
    value: 'mild' as const,
    label: 'Mild',
    icon: Gauge,
    description: 'Subtle improvements, OEM+ reliability',
    color: 'text-info',
    bgColor: 'bg-info-wash',
    borderColor: 'border-info-border',
    hoverBg: 'hover:bg-cyan-500/30',
  },
  {
    value: 'moderate' as const,
    label: 'Moderate',
    icon: Zap,
    description: 'Balanced performance and reliability',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/30',
    hoverBg: 'hover:bg-yellow-500/30',
  },
  {
    value: 'aggressive' as const,
    label: 'Aggressive',
    icon: Rocket,
    description: 'Maximum performance, track-focused',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
    hoverBg: 'hover:bg-red-500/30',
  },
];

export default function PerformanceGoalSelector({ vehicleId, currentGoal, onGoalChange }: PerformanceGoalSelectorProps) {
  const [selectedGoal, setSelectedGoal] = useState<'mild' | 'moderate' | 'aggressive'>(currentGoal);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setSelectedGoal(currentGoal);
  }, [currentGoal]);

  const handleGoalSelect = async (goal: 'mild' | 'moderate' | 'aggressive') => {
    if (goal === currentGoal) return;

    setIsUpdating(true);
    setSelectedGoal(goal);

    try {
      const result = await updatePerformanceGoal(vehicleId, goal);

      if (result.success) {
        toast.success(`Performance goal updated to ${goal}`);
        onGoalChange?.(goal);
        invalidateDashboardCache(vehicleId);
      } else {
        toast.error('Failed to update performance goal');
        setSelectedGoal(currentGoal);
      }
    } catch {
      toast.error('Failed to update performance goal');
      setSelectedGoal(currentGoal);
    }

    setIsUpdating(false);
  };

  return (
    <Card className="bg-white/5 border-white/10 mb-4">
      <CardHeader>
        <CardTitle className="text-white text-sm">Performance Goal</CardTitle>
        <CardDescription className="text-white/60 text-xs">
          AI suggestions will align with your performance preference
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {GOALS.map((goal) => {
            const Icon = goal.icon;
            const isSelected = selectedGoal === goal.value;

            return (
              <button
                key={goal.value}
                onClick={() => handleGoalSelect(goal.value)}
                disabled={isUpdating}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                  isSelected
                    ? `${goal.bgColor} ${goal.borderColor}`
                    : `bg-white/5 border-white/10 ${goal.hoverBg}`
                } ${isUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <Icon className={`h-6 w-6 ${isSelected ? goal.color : 'text-white/60'}`} />
                <div className="text-center">
                  <div className={`font-semibold text-xs ${isSelected ? 'text-white' : 'text-white/80'}`}>
                    {goal.label}
                  </div>
                  <div className="text-xs text-white/50 mt-1 leading-tight">
                    {goal.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
