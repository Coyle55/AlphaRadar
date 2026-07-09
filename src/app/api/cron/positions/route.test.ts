import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db/pool';
import { upsertToken } from '@/lib/db/tokens';
import { closePosition, insertPosition } from '@/lib/db/positions';
import { createTestUser } from '@/lib/testing/testUser';
import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

beforeEach(async () => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
  await getPool().query('truncate table alerts, positions, token_scores, token_snapshots, tokens cascade');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = ORIGINAL_TELEGRAM_CHAT_ID;
  await closePool();
});

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/positions', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function telegramSuccessBranch(url: string): { ok: true; text: () => Promise<string> } | undefined {
  return url.includes('api.telegram.org') ? { ok: true, text: async () => '' } : undefined;
}

describe('POST /api/cron/positions', () => {
  it('rejects requests without the correct bearer token', async () => {
    const response = await POST(makeRequest('Bearer wrong'));
    expect(response.status).toBe(401);
  });

  it('fails closed with a 500 if CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await POST(makeRequest('Bearer undefined'));
    expect(response.status).toBe(500);
  });

  it('returns zero counts when there are no open positions', async () => {
    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 0, total: 0, alertsFired: 0 });
  });

  it('processes an open position, writes a snapshot, and fires a take_profit alert', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-1',
      pairAddress: 'pair-cronpos-1',
      symbol: 'CPOS1',
      name: 'Cron Position Coin 1',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });

    const currentPair = {
      chainId: 'solana',
      pairAddress: 'pair-cronpos-1',
      baseToken: { address: 'mint-cronpos-1', name: 'Cron Position Coin 1', symbol: 'CPOS1' },
      priceUsd: '0.003',
      priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 },
      liquidity: { usd: 50000, base: 1000, quote: 1000 },
      volume: { h24: 100000, h6: 30000, h1: 5000, m5: 500 },
      txns: {
        m5: { buys: 5, sells: 5 },
        h1: { buys: 50, sells: 50 },
        h6: { buys: 200, sells: 200 },
        h24: { buys: 500, sells: 500 },
      },
      marketCap: 1_500_000,
      fdv: 1_500_000,
      pairCreatedAt: Date.now() - 60 * 60 * 1000,
    };

    const mockFetch = vi.fn(async (url: string) => {
      const telegram = telegramSuccessBranch(url);
      if (telegram) return telegram;
      if (url.includes('mint-cronpos-1')) {
        return { ok: true, json: async () => [currentPair] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    // priceUsd 0.003 is 3x entryPrice 0.001 -> take_profit fires on price alone;
    // exit_warning correctly does not fire (no prior snapshot, first-ever price
    // equals its own local high so drop ratio is 0, volumeMomentum is 0).
    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 1, skipped: 0, total: 1, alertsFired: 1 });

    const snapshots = await getPool().query('select * from token_snapshots where token_id = $1', [token.id]);
    expect(snapshots.rows).toHaveLength(1);

    const alerts = await getPool().query('select alert_type, user_id, position_id, telegram_sent from alerts');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].alert_type).toBe('take_profit');
    expect(alerts.rows[0].user_id).toBe(user.id);
    expect(alerts.rows[0].position_id).toBe(position.id);
    expect(alerts.rows[0].telegram_sent).toBe(true);
  });

  it('does not process a closed position', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-2',
      pairAddress: 'pair-cronpos-2',
      symbol: 'CPOS2',
      name: 'Cron Position Coin 2',
      initialLiquidityUsd: 50000,
    });
    const position = await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });
    await closePosition(position.id, 0.0005, 250000);

    const mockFetch = vi.fn(async () => {
      throw new Error('should not be called for a closed position');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 0, total: 0, alertsFired: 0 });
  });

  it('skips a position whose pair fetch throws, without failing the whole tick', async () => {
    const user = await createTestUser();
    const token = await upsertToken({
      mintAddress: 'mint-cronpos-3',
      pairAddress: 'pair-cronpos-3',
      symbol: 'CPOS3',
      name: 'Cron Position Coin 3',
      initialLiquidityUsd: 50000,
    });
    await insertPosition({
      userId: user.id,
      tokenId: token.id,
      entryPrice: 0.001,
      entryMarketCap: 500000,
    });

    const mockFetch = vi.fn(async () => {
      throw new Error('network error');
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST(makeRequest('Bearer test-secret'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 0, skipped: 1, total: 1, alertsFired: 0 });
  });
});
