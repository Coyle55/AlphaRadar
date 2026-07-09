// src/app/api/positions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { getEffectiveMarketCap, selectPair } from '@/lib/scan/filter';
import { getTokenById } from '@/lib/db/tokens';
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

  let body: { exitPrice?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { exitPrice } = body;
  if (typeof exitPrice !== 'number' || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return NextResponse.json(
      { error: 'exitPrice is required and must be a positive number' },
      { status: 400 }
    );
  }

  const token = await getTokenById(position.tokenId);
  if (!token) {
    return NextResponse.json({ error: 'token not found for this position' }, { status: 400 });
  }

  let pairs;
  try {
    pairs = await fetchTokenPairs(token.mintAddress);
  } catch (err) {
    console.error(`positions: failed to fetch pairs for ${token.mintAddress}`, err);
    return NextResponse.json({ error: 'failed to look up token' }, { status: 400 });
  }

  const pair = selectPair(pairs, token.mintAddress);
  if (!pair) {
    return NextResponse.json({ error: 'no DexScreener pair found for that mint address' }, { status: 400 });
  }

  const exitMarketCap = getEffectiveMarketCap(pair);
  if (exitMarketCap === undefined) {
    return NextResponse.json({ error: 'token has no usable market cap data yet' }, { status: 400 });
  }

  await closePosition(id, exitPrice, exitMarketCap);

  return NextResponse.json({ ok: true }, { status: 200 });
}
