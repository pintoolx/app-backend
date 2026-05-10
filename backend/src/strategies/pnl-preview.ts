import { createHash } from 'crypto';
import { type CompiledStrategyIR } from '../strategy-compiler/strategy-compiler.service';

/**
 * Synthetic 30d PnL preview generator for *draft* / *un-deployed* strategies.
 *
 * Real PnL comes from `strategy_public_snapshots` aggregated across deployments;
 * pre-publish there is none. We generate a deterministic curve from
 * `compiled.publicMetadata.riskProfile.level` + the protocol mix so the
 * Inspector "30d PnL preview" widget has *something* credible to draw.
 *
 * The response is always tagged `isPreview: true` upstream — it must NEVER
 * be presented as actual yield. Frontend must display "Preview - actual
 * returns will vary" alongside.
 */

const APY_BY_RISK: Record<'low' | 'medium' | 'high', number> = {
  low: 0.05,
  medium: 0.12,
  high: 0.2,
};

/**
 * Per-protocol APY bumpers (multiplicative). Combined geometrically over the
 * strategy's protocol set so adding two high-yield protocols doesn't blow
 * up the projected APY linearly.
 */
const PROTOCOL_BUMP: Record<string, number> = {
  Drift: 1.3,
  Jupiter: 1.0,
  Kamino: 1.05,
  Lulo: 1.05,
  Stake: 0.9,
  Sanctum: 0.95,
  Orca: 1.1,
  Pyth: 1.0,
  Helius: 1.0,
  System: 1.0,
  Custom: 1.0,
};

export interface PnlPreviewPoint {
  t: string;
  pnlSummaryBps: number;
}

export interface PnlPreviewResult {
  isPreview: true;
  points: PnlPreviewPoint[];
  expectedApyBps: number;
}

export function buildPnlPreview(
  strategyId: string,
  compiled: CompiledStrategyIR,
  days = 30,
): PnlPreviewResult {
  const baseApy = APY_BY_RISK[compiled.publicMetadata.riskProfile.level] ?? APY_BY_RISK.medium;
  const protocols = compiled.publicMetadata.protocols ?? [];
  const bumpProduct =
    protocols.length === 0
      ? 1
      : protocols.reduce((acc, p) => acc * (PROTOCOL_BUMP[p] ?? 1.0), 1) ** (1 / protocols.length);
  const apy = baseApy * bumpProduct;

  // Deterministic noise from strategyId so repeat calls produce the same
  // curve. ±0.2% jitter on the cumulative bps so the line isn't perfectly
  // straight but still climbs monotonically on average.
  const seed = createHash('sha256').update(strategyId).digest();
  const jitterBpsAt = (i: number) => ((seed[i % 32] - 128) / 128) * 20;

  const today = new Date();
  const points: PnlPreviewPoint[] = [];
  for (let d = 0; d < days; d++) {
    const t = new Date(today.getTime() - (days - 1 - d) * 86400000);
    // Linear cumulative growth — last day reaches apy * (days/365) in bps.
    const cumulativeBps = ((apy * (d + 1)) / 365) * 10000;
    points.push({
      t: t.toISOString(),
      pnlSummaryBps: Math.round(cumulativeBps + jitterBpsAt(d)),
    });
  }

  return {
    isPreview: true,
    points,
    expectedApyBps: Math.round(apy * 10000),
  };
}
