import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export interface TestUser {
  id: string;
  email: string;
}

export async function createTestUser(): Promise<TestUser> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const email = `test-${randomUUID()}@example.com`;
  const password = 'test-password-123';
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? 'no user returned'}`);
  }
  return { id: data.user.id, email };
}
