export type RiskPreset = 'conservative' | 'moderate' | 'aggressive';

export const RISK_PRESETS: Record<RiskPreset, { maxDrawdownBps: number }> = {
  conservative: { maxDrawdownBps: 500 },
  moderate: { maxDrawdownBps: 1500 },
  aggressive: { maxDrawdownBps: 3000 },
};
