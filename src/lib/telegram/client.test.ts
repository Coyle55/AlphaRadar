import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from './client';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-id';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('sendTelegramMessage', () => {
  it('posts to the Telegram Bot API with the configured token and chat id', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    await sendTelegramMessage('hello world');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: 'test-chat-id', text: 'hello world', parse_mode: 'Markdown' }),
      })
    );
  });

  it('throws with response details when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' }));

    await expect(sendTelegramMessage('hello')).rejects.toThrow('Telegram sendMessage failed: 400 bad request');
  });

  it('throws if TELEGRAM_BOT_TOKEN is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(sendTelegramMessage('hello')).rejects.toThrow(
      'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured'
    );
  });

  it('throws if TELEGRAM_CHAT_ID is not configured', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    await expect(sendTelegramMessage('hello')).rejects.toThrow(
      'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured'
    );
  });
});
