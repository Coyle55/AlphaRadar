import { createClient } from '@/lib/supabase/server';

export interface CurrentUser {
  id: string;
  email: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}
