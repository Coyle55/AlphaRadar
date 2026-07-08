import { getPool } from '../db/pool';

export interface PriorSnapshot {
  liquidityUsd: number;
  priceUsd: number;
  capturedAt: string;
}

export async function getPriorSnapshot(tokenId: string): Promise<PriorSnapshot | null> {
  const result = await getPool().query(
    `select liquidity_usd, price_usd, captured_at
     from token_snapshots
     where token_id = $1
     order by captured_at desc
     offset 1 limit 1`,
    [tokenId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    liquidityUsd: Number(row.liquidity_usd),
    priceUsd: Number(row.price_usd),
    capturedAt: row.captured_at.toISOString(),
  };
}

export async function getLocalHighPrice(tokenId: string): Promise<number | null> {
  const result = await getPool().query(`select max(price_usd) as max_price from token_snapshots where token_id = $1`, [
    tokenId,
  ]);
  const maxPrice = result.rows[0]?.max_price;
  return maxPrice === null || maxPrice === undefined ? null : Number(maxPrice);
}
