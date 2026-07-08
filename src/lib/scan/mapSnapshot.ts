import type { DexScreenerPair } from '../dexscreener/types';
import type { TokenSnapshotInput } from '../db/tokens';

export function mapPairToSnapshot(pair: DexScreenerPair): TokenSnapshotInput {
  if (!Number.isFinite(pair.marketCap)) {
    throw new Error(
      `mapPairToSnapshot called on a pair with a non-finite marketCap (${pair.pairAddress}) — this pair should have been rejected by passesHardFilter first`
    );
  }
  return {
    priceUsd: parseFloat(pair.priceUsd),
    liquidityUsd: pair.liquidity.usd,
    volume1hUsd: pair.volume.h1,
    volume24hUsd: pair.volume.h24,
    buys1h: pair.txns.h1.buys,
    sells1h: pair.txns.h1.sells,
    marketCapUsd: pair.marketCap as number,
  };
}
