import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mockSignUp = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signUp: mockSignUp },
  }),
}));

beforeEach(() => {
  mockSignUp.mockReset();
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/signup', () => {
  it('returns 400 when email is missing', async () => {
    const response = await POST(makeRequest({ password: 'hunter22' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const response = await POST(makeRequest({ email: 'a@b.com' }));
    expect(response.status).toBe(400);
  });

  it('creates a user and returns 201 with sessionEstablished true when a session is issued immediately', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-123' }, session: { access_token: 'fake-token' } },
      error: null,
    });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ userId: 'user-123', sessionEstablished: true });
    expect(mockSignUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hunter22' });
  });

  it('returns 201 with sessionEstablished false when email confirmation is pending', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-456' }, session: null },
      error: null,
    });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ userId: 'user-456', sessionEstablished: false });
  });

  it('returns 400 with the Supabase error message on failure', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Password should be at least 6 characters' },
    });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Password should be at least 6 characters' });
  });

  it('returns a generic message on duplicate-account signup, not the specific Supabase error', async () => {
    mockSignUp.mockResolvedValue({ data: { user: null }, error: { message: 'User already registered' } });

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter22' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'unable to create account with the provided details' });
    expect(JSON.stringify(body)).not.toContain('User already registered');
  });

  it('returns 400 with invalid request body error on malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api/auth/signup', {
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
