import { getPool } from './pool';

export interface TokenRecord {
  id: string;
  mintAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  initialLiquidityUsd: number;
}

export interface TokenSnapshotInput {
  priceUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys1h: number;
  sells1h: number;
  marketCapUsd: number;
}

export interface ScoreFactors {
  volumeMomentum: number;
  liquidityGrowth: number;
  priceStrength: number;
  buySellRatio: number;
  marketCapBand: number;
  liquidityLevel: number;
  wickRejection: number;
}

export interface ScoreBreakdown {
  total: number;
  factors: ScoreFactors;
}

export async function upsertToken(input: {
  mintAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  initialLiquidityUsd: number;
}): Promise<TokenRecord> {
  const result = await getPool().query(
    `insert into tokens (mint_address, pair_address, symbol, name, initial_liquidity_usd)
     values ($1, $2, $3, $4, $5)
     on conflict (mint_address) do update set mint_address = excluded.mint_address
     returning id, mint_address, pair_address, symbol, name, initial_liquidity_usd`,
    [input.mintAddress, input.pairAddress, input.symbol, input.name, input.initialLiquidityUsd]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    mintAddress: row.mint_address,
    pairAddress: row.pair_address,
    symbol: row.symbol,
    name: row.name,
    initialLiquidityUsd: Number(row.initial_liquidity_usd),
  };
}

export async function insertSnapshot(tokenId: string, snapshot: TokenSnapshotInput): Promise<string> {
  const result = await getPool().query(
    `insert into token_snapshots
       (token_id, price_usd, liquidity_usd, volume_1h_usd, volume_24h_usd, buys_1h, sells_1h, market_cap_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      tokenId,
      snapshot.priceUsd,
      snapshot.liquidityUsd,
      snapshot.volume1hUsd,
      snapshot.volume24hUsd,
      snapshot.buys1h,
      snapshot.sells1h,
      snapshot.marketCapUsd,
    ]
  );
  return result.rows[0].id;
}

export async function insertScore(snapshotId: string, score: ScoreBreakdown): Promise<void> {
  await getPool().query(
    `insert into token_scores (snapshot_id, total_score, factors) values ($1, $2, $3)`,
    [snapshotId, score.total, JSON.stringify(score.factors)]
  );
}
