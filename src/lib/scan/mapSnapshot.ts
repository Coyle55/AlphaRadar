import type { DexScreenerPair } from '../dexscreener/types';
import type { TokenSnapshotInput } from '../db/tokens';
import { getEffectiveMarketCap } from './filter';

export function mapPairToSnapshot(pair: DexScreenerPair): TokenSnapshotInput {
  const marketCap = getEffectiveMarketCap(pair);
  if (!Number.isFinite(marketCap)) {
    throw new Error(
      `mapPairToSnapshot called on a pair with no usable marketCap or fdv (${pair.pairAddress}) — this pair should have been rejected by passesHardFilter first`
    );
  }
  if (!pair.liquidity || !Number.isFinite(pair.liquidity.usd)) {
    throw new Error(
      `mapPairToSnapshot called on a pair with no liquidity data (${pair.pairAddress}) — this pair should have been rejected by passesHardFilter first`
    );
  }
  return {
    priceUsd: parseFloat(pair.priceUsd),
    liquidityUsd: pair.liquidity.usd,
    volume1hUsd: pair.volume.h1,
    volume24hUsd: pair.volume.h24,
    buys1h: pair.txns.h1.buys,
    sells1h: pair.txns.h1.sells,
    marketCapUsd: marketCap as number,
  };
}
