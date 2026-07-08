import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mockSignOut = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signOut: mockSignOut },
  }),
}));

beforeEach(() => {
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue({ error: null });
});

describe('POST /api/auth/logout', () => {
  it('signs the user out and returns 200', async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockSignOut).toHaveBeenCalled();
  });
});
