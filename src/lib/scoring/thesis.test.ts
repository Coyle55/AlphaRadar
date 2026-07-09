import { describe, expect, it } from "vitest";
import { computeThesis } from "./thesis";

describe("computeThesis", () => {
  it("sets entry to the current price and computes fixed percentage bands", () => {
    const thesis = computeThesis(1.0);
    expect(thesis.entry).toBe(1.0);
    expect(thesis.stop).toBeCloseTo(0.85);
    expect(thesis.takeProfit1).toBeCloseTo(1.5);
    expect(thesis.takeProfit2).toBeCloseTo(2.0);
  });

  it("scales correctly for very small meme-coin prices", () => {
    const thesis = computeThesis(0.000042);
    expect(thesis.entry).toBeCloseTo(0.000042);
    expect(thesis.stop).toBeCloseTo(0.0000357);
    expect(thesis.takeProfit1).toBeCloseTo(0.000063);
    expect(thesis.takeProfit2).toBeCloseTo(0.000084);
  });
});
