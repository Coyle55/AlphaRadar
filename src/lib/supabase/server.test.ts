import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './server';

const mockCreateServerClient = vi.fn().mockReturnValue({ mocked: true });
const mockSet = vi.fn();
const mockGetAll = vi.fn().mockReturnValue([{ name: 'sb-token', value: 'abc' }]);

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mockGetAll, set: mockSet }),
}));

beforeEach(() => {
  mockCreateServerClient.mockClear();
  mockSet.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

describe('createClient', () => {
  it('constructs a Supabase server client with the configured URL and anon key', async () => {
    await createClient();

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'test-anon-key',
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      })
    );
  });

  it('wires cookies.getAll to the underlying cookie store', async () => {
    await createClient();

    const options = mockCreateServerClient.mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
  });

  it('wires cookies.setAll to call set on each cookie', async () => {
    await createClient();

    const options = mockCreateServerClient.mock.calls[0][2];
    options.cookies.setAll([{ name: 'sb-token', value: 'xyz', options: { path: '/' } }]);

    expect(mockSet).toHaveBeenCalledWith('sb-token', 'xyz', { path: '/' });
  });
});
