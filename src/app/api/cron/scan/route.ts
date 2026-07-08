import { NextRequest, NextResponse } from 'next/server';
import { fetchLatestTokenProfiles, fetchTokenPairs } from '@/lib/dexscreener/client';
import type { DexScreenerPair } from '@/lib/dexscreener/types';
import { passesHardFilter } from '@/lib/scan/filter';
import { mapPairToSnapshot } from '@/lib/scan/mapSnapshot';
import { scoreToken } from '@/lib/scoring/score';
import { upsertToken, insertSnapshot, insertScore } from '@/lib/db/tokens';

function selectPair(pairs: DexScreenerPair[], tokenAddress: string): DexScreenerPair | undefined {
  const matching = pairs.filter((p) => p.baseToken.address === tokenAddress);
  const candidates = matching.length > 0 ? matching : pairs;
  return candidates.reduce<DexScreenerPair | undefined>((best, p) => {
    if (!best || p.liquidity.usd > best.liquidity.usd) return p;
    return best;
  }, undefined);
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
    } catch (err) {
      console.error(`scan: failed to process token ${profile.tokenAddress}`, err);
      skipped++;
    }
  }

  return NextResponse.json({ scored, skipped, total: profiles.length });
}
