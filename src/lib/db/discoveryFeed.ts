import { getPool } from './pool';

export interface DiscoveryFeedItem {
  tokenId: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  totalScore: number;
  capturedAt: string;
}

const RECENCY_WINDOW_MINUTES = 120;
const FEED_LIMIT = 50;

export async function getDiscoveryFeed(): Promise<DiscoveryFeedItem[]> {
  const result = await getPool().query(
    `select * from (
       select distinct on (t.id)
         t.id as token_id, t.symbol, t.name,
         s.price_usd, s.market_cap_usd, s.liquidity_usd, s.volume_1h_usd, s.captured_at,
         sc.total_score
       from tokens t
       join token_snapshots s on s.token_id = t.id
       join token_scores sc on sc.snapshot_id = s.id
       where s.captured_at > now() - make_interval(mins => $1)
       order by t.id, s.captured_at desc
     ) latest
     order by total_score desc
     limit $2`,
    [RECENCY_WINDOW_MINUTES, FEED_LIMIT]
  );

  return result.rows.map((row) => ({
    tokenId: row.token_id,
    symbol: row.symbol,
    name: row.name,
    priceUsd: Number(row.price_usd),
    marketCapUsd: Number(row.market_cap_usd),
    liquidityUsd: Number(row.liquidity_usd),
    volume1hUsd: Number(row.volume_1h_usd),
    totalScore: Number(row.total_score),
    capturedAt: row.captured_at.toISOString(),
  }));
}
