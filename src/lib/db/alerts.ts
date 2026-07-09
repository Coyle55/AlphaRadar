import { getPool } from './pool';
import type { ScoreBreakdown } from './tokens';
import type { DexScreenerPair } from '../dexscreener/types';

export type AlertType =
  | 'buy_watch'
  | 'volume_spike'
  | 'liquidity_danger'
  | 'trend_break'
  | 'take_profit'
  | 'exit_warning';

export const ALERT_COOLDOWN_MINUTES = 30;

export interface AlertPayload {
  score: ScoreBreakdown;
  pair: DexScreenerPair;
}

export interface NewAlertInput {
  tokenId: string;
  alertType: AlertType;
  payload: AlertPayload;
  userId?: string;
  positionId?: string;
}

export interface AlertRecord {
  id: string;
  tokenId: string;
  alertType: AlertType;
  triggeredAt: string;
  payload: AlertPayload;
  telegramSent: boolean;
  telegramError: string | null;
  userId: string | null;
  positionId: string | null;
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

export async function wasPositionRecentlyAlerted(
  positionId: string,
  alertType: AlertType,
  cooldownMinutes: number = ALERT_COOLDOWN_MINUTES
): Promise<boolean> {
  const result = await getPool().query(
    `select 1 from alerts
     where position_id = $1 and alert_type = $2 and triggered_at > now() - make_interval(mins => $3)
     limit 1`,
    [positionId, alertType, cooldownMinutes]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertAlert(input: NewAlertInput): Promise<AlertRecord> {
  const result = await getPool().query(
    `insert into alerts (token_id, alert_type, payload, user_id, position_id)
     values ($1, $2, $3, $4, $5)
     returning id, token_id, alert_type, triggered_at, payload, telegram_sent, telegram_error, user_id, position_id`,
    [input.tokenId, input.alertType, JSON.stringify(input.payload), input.userId ?? null, input.positionId ?? null]
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
    userId: row.user_id,
    positionId: row.position_id,
  };
}

export async function markTelegramResult(alertId: string, sent: boolean, error: string | null): Promise<void> {
  await getPool().query(`update alerts set telegram_sent = $2, telegram_error = $3 where id = $1`, [
    alertId,
    sent,
    error,
  ]);
}
