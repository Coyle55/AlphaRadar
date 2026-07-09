import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, closePool } from "./pool";
import { upsertToken, insertSnapshot, insertScore } from "./tokens";
import { getTokenDetail } from "./tokenDetail";

beforeEach(async () => {
  await getPool().query("truncate table alerts, positions, token_scores, token_snapshots, tokens cascade");
});

afterAll(async () => {
  await closePool();
});

describe("getTokenDetail", () => {
  it("returns null when no token matches the mint address", async () => {
    const detail = await getTokenDetail("does-not-exist");
    expect(detail).toBeNull();
  });

  it("returns null when the token exists but has never been scanned or scored", async () => {
    await upsertToken({
      mintAddress: "mint-unscanned",
      pairAddress: "pair-unscanned",
      symbol: "UNSCAN",
      name: "Unscanned Coin",
      initialLiquidityUsd: 1000,
    });

    const detail = await getTokenDetail("mint-unscanned");
    expect(detail).toBeNull();
  });

  it("returns the latest snapshot, score factors, and full chronological price history", async () => {
    const token = await upsertToken({
      mintAddress: "mint-detail",
      pairAddress: "pair-detail",
      symbol: "DETAIL",
      name: "Detail Coin",
      initialLiquidityUsd: 50000,
    });

    const factors1 = {
      volumeMomentum: 10,
      liquidityGrowth: 5,
      priceStrength: 5,
      buySellRatio: 5,
      marketCapBand: 10,
      liquidityLevel: 15,
      wickRejection: 0,
    };
    const snapshot1Id = await insertSnapshot(token.id, {
      priceUsd: 0.01,
      liquidityUsd: 50000,
      volume1hUsd: 5000,
      volume24hUsd: 20000,
      buys1h: 10,
      sells1h: 5,
      marketCapUsd: 1_000_000,
    });
    await insertScore(snapshot1Id, { total: 50, factors: factors1 });
    await getPool().query(
      `update token_snapshots set captured_at = now() - make_interval(hours => 2) where id = $1`,
      [snapshot1Id]
    );

    const factors2 = {
      volumeMomentum: 15,
      liquidityGrowth: 8,
      priceStrength: 6,
      buySellRatio: 7,
      marketCapBand: 10,
      liquidityLevel: 15,
      wickRejection: 0,
    };
    const snapshot2Id = await insertSnapshot(token.id, {
      priceUsd: 0.015,
      liquidityUsd: 60000,
      volume1hUsd: 8000,
      volume24hUsd: 30000,
      buys1h: 20,
      sells1h: 5,
      marketCapUsd: 1_500_000,
    });
    await insertScore(snapshot2Id, { total: 61, factors: factors2 });

    const detail = await getTokenDetail("mint-detail");

    expect(detail).not.toBeNull();
    expect(detail!.mintAddress).toBe("mint-detail");
    expect(detail!.symbol).toBe("DETAIL");
    expect(detail!.priceUsd).toBe(0.015);
    expect(detail!.totalScore).toBe(61);
    expect(detail!.factors).toEqual(factors2);
    expect(detail!.priceHistory).toHaveLength(2);
    expect(detail!.priceHistory[0].priceUsd).toBe(0.01);
    expect(detail!.priceHistory[1].priceUsd).toBe(0.015);
  });
});
