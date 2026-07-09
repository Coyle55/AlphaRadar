import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { fetchTokenPairs } from '@/lib/dexscreener/client';
import { getEffectiveMarketCap, selectPair } from '@/lib/scan/filter';
import { upsertToken } from '@/lib/db/tokens';
import { insertPosition } from '@/lib/db/positions';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  let body: { mintAddress?: string; entryPrice?: number; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { mintAddress, entryPrice, amount } = body;
  if (!mintAddress || typeof entryPrice !== 'number') {
    return NextResponse.json({ error: 'mintAddress and entryPrice are required' }, { status: 400 });
  }

  let pairs;
  try {
    pairs = await fetchTokenPairs(mintAddress);
  } catch (err) {
    console.error(`positions: failed to fetch pairs for ${mintAddress}`, err);
    return NextResponse.json({ error: 'failed to look up token' }, { status: 400 });
  }

  const pair = selectPair(pairs, mintAddress);
  if (!pair) {
    return NextResponse.json({ error: 'no DexScreener pair found for that mint address' }, { status: 400 });
  }

  const entryMarketCap = getEffectiveMarketCap(pair);
  if (entryMarketCap === undefined) {
    return NextResponse.json({ error: 'token has no usable market cap data yet' }, { status: 400 });
  }

  const token = await upsertToken({
    mintAddress: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    initialLiquidityUsd: pair.liquidity?.usd ?? 0,
  });

  const position = await insertPosition({
    userId: user.id,
    tokenId: token.id,
    entryPrice,
    entryMarketCap,
    amount,
  });

  return NextResponse.json({ position }, { status: 201 });
}
