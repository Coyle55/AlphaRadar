import { fetchLatestTokenProfiles, fetchTokenPairs } from '@/lib/dexscreener/client';
import type { DexScreenerPair } from '@/lib/dexscreener/types';
import { passesHardFilter, selectPair } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { upsertToken, insertSnapshot, insertScore } from '@/lib/db/tokens';
import type { ScoreBreakdown } from '@/lib/db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from '@/lib/scan/history';
import { evaluateDiscoveryAlerts } from '@/lib/alerts/rules';
import { wasRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from '@/lib/db/alerts';
import { formatAlertMessage } from '@/lib/alerts/format';
import { sendTelegramMessage } from '@/lib/telegram/client';

export interface ScanRunResult {
  scored: number;
  skipped: number;
  total: number;
  alertsFired: number;
}

async function evaluateAndDeliverAlerts(tokenId: string, pair: DexScreenerPair, score: ScoreBreakdown): Promise<number> {
  const [priorSnapshot, localHighPrice] = await Promise.all([
    getPriorSnapshot(tokenId),
    getLocalHighPrice(tokenId),
  ]);

  const firedTypes = evaluateDiscoveryAlerts({ pair, score, priorSnapshot, localHighPrice });
  let delivered = 0;

  for (const alertType of firedTypes) {
    const inCooldown = await wasRecentlyAlerted(tokenId, alertType, ALERT_COOLDOWN_MINUTES);
    if (inCooldown) continue;

    const alert = await insertAlert({ tokenId, alertType, payload: { score, pair } });
    try {
      await sendTelegramMessage(formatAlertMessage(alertType, pair));
      await markTelegramResult(alert.id, true, null);
      delivered++;
    } catch (err) {
      console.error(`alert: telegram send failed for ${alertType} on ${pair.pairAddress}`, err);
      await markTelegramResult(alert.id, false, (err as Error).message);
    }
  }

  return delivered;
}

export async function runScanPipeline(): Promise<ScanRunResult> {
  const profiles = await fetchLatestTokenProfiles();

  const now = new Date();
  let scored = 0;
  let skipped = 0;
  let alertsFired = 0;

  for (const profile of profiles) {
    try {
      const pairs = await fetchTokenPairs(profile.tokenAddress);
      const pair = selectPair(pairs, profile.tokenAddress);

      if (!pair || !passesHardFilter(pair, now)) {
        skipped++;
        continue;
      }

      const token = await upsertToken({
        mintAddress: pair.baseToken.address,
        pairAddress: pair.pairAddress,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        initialLiquidityUsd: pair.liquidity!.usd, // guaranteed present: passesHardFilter already rejected pairs without it
      });

      const snapshot = mapPairToSnapshot(pair);
      const snapshotId = await insertSnapshot(token.id, snapshot);
      const score = scoreToken({ pair, initialLiquidityUsd: token.initialLiquidityUsd });
      await insertScore(snapshotId, score);
      scored++;

      try {
        alertsFired += await evaluateAndDeliverAlerts(token.id, pair, score);
      } catch (err) {
        console.error(`alert: evaluation failed for ${pair.pairAddress}`, err);
      }
    } catch (err) {
      console.error(`scan: failed to process token ${profile.tokenAddress}`, err);
      skipped++;
    }
  }

  return { scored, skipped, total: profiles.length, alertsFired };
}
