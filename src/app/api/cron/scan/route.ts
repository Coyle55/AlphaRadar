import { NextRequest, NextResponse } from 'next/server';
import { runScanPipeline } from '@/lib/scan/run';
import { recordScanRunStart } from '@/lib/db/scanRuns';

export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('scan: CRON_SECRET is not configured');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await recordScanRunStart('cron');

  try {
    const result = await runScanPipeline();
    return NextResponse.json(result);
  } catch (err) {
    console.error('scan: failed to fetch token profiles', err);
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 });
  }
}
