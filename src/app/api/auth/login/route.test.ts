import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mockSignInWithPassword = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  }),
}));

beforeEach(() => {
  mockSignInWithPassword.mockReset();
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  it('returns 400 when email is missing', async () => {
    const response = await POST(makeRequest({ password: 'hunter22' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const response = await POST(makeRequest({ email: 'a@b.com' }));
    expect(response.status).toBe(400);
  });

  it('logs in and returns 200 on success', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ userId: 'user-123' });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter22' });
  });

  it('returns a generic 401 on bad credentials, not the specific Supabase error', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'wrong' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'invalid email or password' });
  });

  it('returns 400 with invalid request body error on malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not valid json{',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'invalid request body' });
  });
});
