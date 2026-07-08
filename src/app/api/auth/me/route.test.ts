import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mockGetCurrentUser = vi.fn();

vi.mock('@/lib/auth/getCurrentUser', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

beforeEach(() => {
  mockGetCurrentUser.mockReset();
});

describe('GET /api/auth/me', () => {
  it('returns the current user when logged in', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'user-123', email: 'a@b.com' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: { id: 'user-123', email: 'a@b.com' } });
  });

  it('returns 401 when not logged in', async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'not authenticated' });
  });
});
