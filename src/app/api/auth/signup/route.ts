import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function isDuplicateAccountError(error: { code?: string; message: string }): boolean {
  return error.code === 'user_already_exists' || /already registered/i.test(error.message);
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    if (isDuplicateAccountError(error)) {
      return NextResponse.json({ error: 'unable to create account with the provided details' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(
    { userId: data.user?.id ?? null, sessionEstablished: data.session !== null },
    { status: 201 }
  );
}
