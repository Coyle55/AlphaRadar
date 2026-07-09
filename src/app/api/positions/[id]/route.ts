import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { closePosition, getPositionById } from '@/lib/db/positions';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  const position = await getPositionById(id);

  if (!position) {
    return NextResponse.json({ error: 'position not found' }, { status: 404 });
  }

  if (position.userId !== user.id) {
    return NextResponse.json({ error: 'not authorized to close this position' }, { status: 403 });
  }

  await closePosition(id);

  return NextResponse.json({ ok: true }, { status: 200 });
}
