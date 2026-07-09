import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { runScanPipeline } from '@/lib/scan/run';
import { recordScanRunStart, secondsSinceLastScanRun, MANUAL_SCAN_COOLDOWN_SECONDS } from '@/lib/db/scanRuns';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const secondsSince = await secondsSinceLastScanRun();
  if (secondsSince !== null && secondsSince < MANUAL_SCAN_COOLDOWN_SECONDS) {
    const retryAfterSeconds = Math.ceil(MANUAL_SCAN_COOLDOWN_SECONDS - secondsSince);
    return NextResponse.json({ error: 'scan ran recently', retryAfterSeconds }, { status: 429 });
  }

  await recordScanRunStart('manual');

  try {
    const result = await runScanPipeline();
    return NextResponse.json(result);
  } catch (err) {
    console.error('scan: manual trigger failed to fetch token profiles', err);
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 });
  }
}
