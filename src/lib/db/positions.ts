// src/lib/db/positions.ts
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
  exitPrice: number | null;
  exitMarketCap: number | null;
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

export interface OpenPositionWithPrice {
  id: string;
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  entryMarketCap: number;
  amount: number | null;
  openedAt: string;
  currentPriceUsd: number | null;
  currentPriceCapturedAt: string | null;
}

export interface ClosedPositionSummary {
  id: string;
  tokenId: string;
  mintAddress: string;
  symbol: string;
  name: string;
  entryPrice: number;
  exitPrice: number;
  openedAt: string;
  closedAt: string;
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
    exitPrice: row.exit_price === null ? null : Number(row.exit_price),
    exitMarketCap: row.exit_market_cap === null ? null : Number(row.exit_market_cap),
  };
}

export async function insertPosition(input: NewPositionInput): Promise<PositionRecord> {
  const result = await getPool().query(
    `insert into positions (user_id, token_id, entry_price, entry_market_cap, amount)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at, exit_price, exit_market_cap`,
    [input.userId, input.tokenId, input.entryPrice, input.entryMarketCap, input.amount ?? null]
  );
  return mapPositionRow(result.rows[0]);
}

export async function getPositionById(id: string): Promise<PositionRecord | null> {
  const result = await getPool().query(
    `select id, user_id, token_id, entry_price, entry_market_cap, amount, opened_at, closed_at, exit_price, exit_market_cap
     from positions where id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return mapPositionRow(result.rows[0]);
}

export async function closePosition(id: string, exitPrice: number, exitMarketCap: number): Promise<void> {
  await getPool().query(
    `update positions set closed_at = now(), exit_price = $2, exit_market_cap = $3 where id = $1`,
    [id, exitPrice, exitMarketCap]
  );
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

export async function getOpenPositionsForUser(userId: string): Promise<OpenPositionWithPrice[]> {
  const result = await getPool().query(
    `select p.id, p.token_id, t.mint_address, t.symbol, t.name,
            p.entry_price, p.entry_market_cap, p.amount, p.opened_at,
            latest.price_usd as current_price_usd, latest.captured_at as current_captured_at
     from positions p
     join tokens t on t.id = p.token_id
     left join lateral (
       select price_usd, captured_at
       from token_snapshots s
       where s.token_id = p.token_id
       order by s.captured_at desc
       limit 1
     ) latest on true
     where p.user_id = $1 and p.closed_at is null
     order by p.opened_at desc`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    entryPrice: Number(row.entry_price),
    entryMarketCap: Number(row.entry_market_cap),
    amount: row.amount === null ? null : Number(row.amount),
    openedAt: row.opened_at.toISOString(),
    currentPriceUsd: row.current_price_usd === null ? null : Number(row.current_price_usd),
    currentPriceCapturedAt: row.current_captured_at === null ? null : row.current_captured_at.toISOString(),
  }));
}

export async function getClosedPositionsForUser(userId: string): Promise<ClosedPositionSummary[]> {
  const result = await getPool().query(
    `select p.id, p.token_id, t.mint_address, t.symbol, t.name,
            p.entry_price, p.exit_price, p.opened_at, p.closed_at
     from positions p
     join tokens t on t.id = p.token_id
     where p.user_id = $1 and p.closed_at is not null
     order by p.closed_at desc`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tokenId: row.token_id,
    mintAddress: row.mint_address,
    symbol: row.symbol,
    name: row.name,
    entryPrice: Number(row.entry_price),
    exitPrice: Number(row.exit_price),
    openedAt: row.opened_at.toISOString(),
    closedAt: row.closed_at.toISOString(),
  }));
}
