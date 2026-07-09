import { getPool } from './pool';

export type ScanRunSource = 'cron' | 'manual';

export const MANUAL_SCAN_COOLDOWN_SECONDS = 60;

export async function recordScanRunStart(source: ScanRunSource): Promise<void> {
  await getPool().query(`insert into scan_runs (source) values ($1)`, [source]);
}

export async function secondsSinceLastScanRun(): Promise<number | null> {
  const result = await getPool().query(
    `select extract(epoch from now() - started_at) as seconds_since
     from scan_runs
     order by started_at desc
     limit 1`
  );
  if (result.rowCount === 0) return null;
  return Number(result.rows[0].seconds_since);
}
