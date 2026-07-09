import { getPool } from './pool';
import type { ScoreFactors } from './tokens';

export interface TokenDetailSnapshotPoint {
  priceUsd: number;
  capturedAt: string;
}

export interface TokenDetail {
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  totalScore: number;
  factors: ScoreFactors;
  capturedAt: string;
  priceHistory: TokenDetailSnapshotPoint[];
}

export async function getTokenDetail(mintAddress: string): Promise<TokenDetail | null> {
  const tokenResult = await getPool().query(
    `select id, mint_address, symbol, name from tokens where mint_address = $1`,
    [mintAddress]
  );
  const tokenRow = tokenResult.rows[0];
  if (!tokenRow) {
    return null;
  }

  const [latestResult, historyResult] = await Promise.all([
    getPool().query(
      `select s.price_usd, s.market_cap_usd, s.liquidity_usd, s.volume_1h_usd, s.volume_24h_usd,
              s.captured_at, sc.total_score, sc.factors
       from token_snapshots s
       join token_scores sc on sc.snapshot_id = s.id
       where s.token_id = $1
       order by s.captured_at desc
       limit 1`,
      [tokenRow.id]
    ),
    getPool().query(
      `select price_usd, captured_at from token_snapshots where token_id = $1 order by captured_at asc`,
      [tokenRow.id]
    ),
  ]);

  const latestRow = latestResult.rows[0];
  if (!latestRow) {
    return null;
  }

  return {
    tokenId: tokenRow.id,
    mintAddress: tokenRow.mint_address,
    symbol: tokenRow.symbol,
    name: tokenRow.name,
    priceUsd: Number(latestRow.price_usd),
    marketCapUsd: Number(latestRow.market_cap_usd),
    liquidityUsd: Number(latestRow.liquidity_usd),
    volume1hUsd: Number(latestRow.volume_1h_usd),
    volume24hUsd: Number(latestRow.volume_24h_usd),
    totalScore: Number(latestRow.total_score),
    factors: latestRow.factors,
    capturedAt: latestRow.captured_at.toISOString(),
    priceHistory: historyResult.rows.map((row) => ({
      priceUsd: Number(row.price_usd),
      capturedAt: row.captured_at.toISOString(),
    })),
  };
}
