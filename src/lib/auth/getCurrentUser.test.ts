import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser } from './getCurrentUser';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

beforeEach(() => {
  mockGetUser.mockReset();
});

describe('getCurrentUser', () => {
  it('returns the user when a session is valid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123', email: 'a@b.com' } }, error: null });

    const user = await getCurrentUser();

    expect(user).toEqual({ id: 'user-123', email: 'a@b.com' });
  });

  it('returns null when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'not authenticated' } });

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });
});
