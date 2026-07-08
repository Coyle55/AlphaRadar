import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestTokenProfiles, fetchTokenPairs } from '@/lib/dexscreener/client';
import type { DexScreenerPair } from '@/lib/dexscreener/types';
import { passesHardFilter } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { upsertToken, insertSnapshot, insertScore } from '@/lib/db/tokens';
import type { ScoreBreakdown } from '@/lib/db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from '@/lib/scan/history';
import { evaluateDiscoveryAlerts } from '@/lib/alerts/rules';
import { wasRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from '@/lib/db/alerts';
import { formatAlertMessage } from '@/lib/alerts/format';
import { sendTelegramMessage } from '@/lib/telegram/client';

function selectPair(pairs: DexScreenerPair[], tokenAddress: string): DexScreenerPair | undefined {
  const matching = pairs.filter((p) => p.baseToken.address === tokenAddress);
  const candidates = matching.length > 0 ? matching : pairs;
  return candidates.reduce<DexScreenerPair | undefined>((best, p) => {
    if (!best || p.liquidity.usd > best.liquidity.usd) return p;
    return best;
  }, undefined);
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

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('scan: CRON_SECRET is not configured');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let profiles;
  try {
    profiles = await fetchLatestTokenProfiles();
  } catch (err) {
    console.error('scan: failed to fetch token profiles', err);
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 });
  }

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
        initialLiquidityUsd: pair.liquidity.usd,
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

  return NextResponse.json({ scored, skipped, total: profiles.length, alertsFired });
}
