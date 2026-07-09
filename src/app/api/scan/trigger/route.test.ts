// src/app/api/scan/trigger/route.test.ts
import { beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getPool, closePool } from '@/lib/db/pool';
import { POST } from './route';

vi.mock('@/lib/auth/getCurrentUser', () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from '@/lib/auth/getCurrentUser';

const ORIGINAL_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORIGINAL_TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
  await getPool().query('truncate table alerts, token_scores, token_snapshots, tokens, scan_runs cascade');
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = ORIGINAL_TELEGRAM_CHAT_ID;
  await closePool();
});

describe('POST /api/scan/trigger', () => {
  it('rejects unauthenticated requests', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it('runs the scan pipeline for an authenticated user', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ scored: 0, skipped: 0, total: 0, alertsFired: 0 });

    const runs = await getPool().query("select source from scan_runs");
    expect(runs.rows).toEqual([{ source: 'manual' }]);
  });

  it('rejects a second trigger within the cooldown window', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('token-profiles')) {
        return { ok: true, json: async () => [] };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const first = await POST();
    expect(first.status).toBe(200);

    const second = await POST();
    const secondBody = await second.json();

    expect(second.status).toBe(429);
    expect(secondBody.error).toBe('scan ran recently');
    expect(secondBody.retryAfterSeconds).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
