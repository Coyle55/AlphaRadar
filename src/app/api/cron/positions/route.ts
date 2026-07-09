import { NextRequest, NextResponse } from 'next/server';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { selectPair } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { insertSnapshot, insertScore } from '@/lib/db/tokens';
import type { ScoreBreakdown } from '@/lib/db/tokens';
import { getPriorSnapshot, getLocalHighPrice } from '@/lib/scan/history';
import { evaluatePositionAlerts } from '@/lib/positions/rules';
import { wasPositionRecentlyAlerted, insertAlert, markTelegramResult, ALERT_COOLDOWN_MINUTES } from '@/lib/db/alerts';
import { formatPositionAlertMessage } from '@/lib/positions/format';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { getOpenPositions } from '@/lib/db/positions';
import type { OpenPosition } from '@/lib/db/positions';
import type { DexScreenerPair } from '@/lib/dexscreener/types';

async function evaluateAndDeliverPositionAlerts(
  position: OpenPosition,
  pair: DexScreenerPair,
  score: ScoreBreakdown
): Promise<number> {
  const [priorSnapshot, localHighPrice] = await Promise.all([
    getPriorSnapshot(position.tokenId),
    getLocalHighPrice(position.tokenId),
  ]);

  const firedTypes = evaluatePositionAlerts({
    pair,
    score,
    entryPrice: position.entryPrice,
    entryMarketCap: position.entryMarketCap,
    priorSnapshot,
    localHighPrice,
  });

  let delivered = 0;

  for (const alertType of firedTypes) {
    const inCooldown = await wasPositionRecentlyAlerted(position.id, alertType, ALERT_COOLDOWN_MINUTES);
    if (inCooldown) continue;

    const alert = await insertAlert({
      tokenId: position.tokenId,
      alertType,
      payload: { score, pair },
      userId: position.userId,
      positionId: position.id,
    });

    try {
      await sendTelegramMessage(formatPositionAlertMessage(alertType, pair, position.entryPrice));
      await markTelegramResult(alert.id, true, null);
      delivered++;
    } catch (err) {
      console.error(`position alert: telegram send failed for ${alertType} on position ${position.id}`, err);
      await markTelegramResult(alert.id, false, (err as Error).message);
    }
  }

  return delivered;
}

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('positions: CRON_SECRET is not configured');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const positions = await getOpenPositions();

  let processed = 0;
  let skipped = 0;
  let alertsFired = 0;

  for (const position of positions) {
    try {
      const pairs = await fetchTokenPairs(position.mintAddress);
      const pair = selectPair(pairs, position.mintAddress);

      if (!pair) {
        skipped++;
        continue;
      }

      const snapshot = mapPairToSnapshot(pair);
      const snapshotId = await insertSnapshot(position.tokenId, snapshot);
      const score = scoreToken({ pair, initialLiquidityUsd: position.initialLiquidityUsd });
      await insertScore(snapshotId, score);
      processed++;

      try {
        alertsFired += await evaluateAndDeliverPositionAlerts(position, pair, score);
      } catch (err) {
        console.error(`positions: alert evaluation failed for position ${position.id}`, err);
      }
    } catch (err) {
      console.error(`positions: failed to process position ${position.id}`, err);
      skipped++;
    }
  }

  return NextResponse.json({ processed, skipped, total: positions.length, alertsFired });
}

export { POST as GET };
