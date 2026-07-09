import { getPool } from './pool';

export interface NewPositionInput {
  userId: string;
  tokenId: string;
  entryPrice: number;
  entryMarketCap: number;
  amount?: number;
}

export interface PositionRecord {
  id: string;
  userId: string;
  tokenId: string;
  entryPrice: number;
  entryMarketCap: number;
  amount: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface OpenPosition {
  id: string;
  userId: string;
  tokenId: string;
  mintAddress: string;
  pairAddress: string;
  entryPrice: number;
  entryMarketCap: number;
  initialLiquidityUsd: number;
}

function mapPositionRow(row: any): PositionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenId: row.token_id,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    amount: row.amount === null ? null : Number(row.amount),
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at === null ? null : row.closed_at.toISOString(),
  };
}

export async function insertPosition(input: NewPositionInput): Promise<PositionRecord> {
  const result = await getPool().query(
    `insert into positions (user_id, token_id, entry_price, entry_market_cap, amount)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at`,
    [input.userId, input.tokenId, input.entryPrice, input.entryMarketCap, input.amount ?? null]
  );
  return mapPositionRow(result.rows[0]);
}

export async function getPositionById(id: string): Promise<PositionRecord | null> {
  const result = await getPool().query(
    `select id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at
     from positions where id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return mapPositionRow(result.rows[0]);
}

export async function closePosition(id: string): Promise<void> {
  await getPool().query(`update positions set closed_at = now() where id = $1`, [id]);
}

export async function getOpenPositions(): Promise<OpenPosition[]> {
  const result = await getPool().query(
    `select p.id, p.user_id, p.token_id, p.entry_price, p.entry_market_cap,
            t.mint_address, t.pair_address, t.initial_liquidity_usd
     from positions p
     join tokens t on t.id = p.token_id
     where p.closed_at is null`
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    pairAddress: row.pair_address,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    initialLiquidityUsd: Number(row.initial_liquidity_usd),
  }));
}
