import { getPool } from './pool';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';

export type AlertType = 'buy_watch' | 'volume_spike' | 'liquidity_danger' | 'trend_break';

export const ALERT_COOLDOWN_MINUTES = 30;

export interface AlertPayload {
  score: ScoreBreakdown;
  pair: DexScreenerPair;
}

export interface NewAlertInput {
  tokenId: string;
  alertType: AlertType;
  payload: AlertPayload;
}

export interface AlertRecord {
  id: string;
  tokenId: string;
  alertType: AlertType;
  triggeredAt: string;
  payload: AlertPayload;
  telegramSent: boolean;
  telegramError: string | null;
}

export async function wasRecentlyAlerted(
  tokenId: string,
  alertType: AlertType,
  cooldownMinutes: number = ALERT_COOLDOWN_MINUTES
): Promise<boolean> {
  const result = await getPool().query(
    `select 1 from alerts
     where token_id = $1 and alert_type = $2 and triggered_at > now() - make_interval(mins => $3)
     limit 1`,
    [tokenId, alertType, cooldownMinutes]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertAlert(input: NewAlertInput): Promise<AlertRecord> {
  const result = await getPool().query(
    `insert into alerts (token_id, alert_type, payload)
     values ($1, $2, $3)
     returning id, token_id, alert_type, triggered_at, payload, telegram_sent, telegram_error`,
    [input.tokenId, input.alertType, JSON.stringify(input.payload)]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    tokenId: row.token_id,
    alertType: row.alert_type,
    triggeredAt: row.triggered_at.toISOString(),
    payload: row.payload,
    telegramSent: row.telegram_sent,
    telegramError: row.telegram_error,
  };
}

export async function markTelegramResult(alertId: string, sent: boolean, error: string | null): Promise<void> {
  await getPool().query(`update alerts set telegram_sent = $2, telegram_error = $3 where id = $1`, [
    alertId,
    sent,
    error,
  ]);
}
