import { z } from 'zod';

export const VehicleDataSchema = z.object({
  known_issues: z.array(z.object({
    part: z.string(),
    mileage_range: z.string(),
    severity: z.enum(['Low', 'Medium', 'High']),
    description: z.string(),
  })).default([]),
  maintenance_schedule: z.array(z.object({
    item: z.string(),
    interval: z.string(),
    priority: z.enum(['Critical', 'Recommended', 'Optional']),
  })).default([]),
  fluid_specs: z.object({
    engine_oil: z.string().optional().default('Unknown'),
    transmission_fluid: z.string().optional().default('Unknown'),
    coolant: z.string().optional().default('Unknown'),
    brake_fluid: z.string().optional().default('Unknown'),
  }).default({}),
  common_mods: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    difficulty: z.enum(['Easy', 'Moderate', 'Hard']),
  })).default([]),
  powertrain: z.object({
    engine_type: z.string().nullable().optional(),
    transmission_type: z.string().nullable().optional(),
    drivetrain: z.string().nullable().optional(),
  }).optional().default({}),
  performance_stats: z.object({
    horsepower: z.number().nullable().optional(),
    torque: z.number().nullable().optional(),
    zero_to_sixty: z.number().nullable().optional(),
  }).optional().default({}),
  interesting_facts: z.array(z.string()).default([]),
  reliability_score: z.number().min(1).max(10).default(5),
});

export function extractJSON(text: string): any {
  try {
    const trimmed = text.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const jsonMatch = trimmed.match(/^[\s\S]*?(\{[\s\S]*\}|\[[\s\S]*\])[\s\S]*?$/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    }

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  } catch (error) {
    console.error('JSON extraction failed:', error);
    throw error;
  }
}

export function detectUncertainPowertrainFields(
  engine_type: string | null | undefined,
  transmission_type: string | null | undefined,
  drivetrain: string | null | undefined
) {
  const UNCERTAINTY_MARKER = ' or ';

  const parseOptions = (value: string | null | undefined): string[] | undefined => {
    if (!value) return undefined;
    return value.split(UNCERTAINTY_MARKER).map(opt => opt.trim()).filter(opt => opt.length > 0);
  };

  const engineIsUncertain = !!(engine_type?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));
  const transmissionIsUncertain = !!(transmission_type?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));
  const drivetrainIsUncertain = !!(drivetrain?.toLowerCase().includes(UNCERTAINTY_MARKER.toLowerCase()));

  const hasUncertainty = engineIsUncertain || transmissionIsUncertain || drivetrainIsUncertain;

  return {
    hasUncertainty,
    uncertainFields: {
      ...(engineIsUncertain && {
        engine: {
          isUncertain: true,
          rawValue: engine_type!,
          options: parseOptions(engine_type),
        },
      }),
      ...(transmissionIsUncertain && {
        transmission: {
          isUncertain: true,
          rawValue: transmission_type!,
          options: parseOptions(transmission_type),
        },
      }),
      ...(drivetrainIsUncertain && {
        drivetrain: {
          isUncertain: true,
          rawValue: drivetrain!,
          options: parseOptions(drivetrain),
        },
      }),
    },
    rawValues: {
      engine: engine_type ?? null,
      transmission: transmission_type ?? null,
      drivetrain: drivetrain ?? null,
    },
  };
}
