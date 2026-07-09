import { describe, expect, it } from "vitest";
import { formatUsd, timeAgo, computePriceChange } from "./format";

describe("formatUsd", () => {
  it("formats values a million or more with an M suffix", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50M");
  });

  it("formats values in the thousands with a K suffix", () => {
    expect(formatUsd(45_000)).toBe("$45.0K");
  });

  it("formats sub-dollar values with 6 decimal places", () => {
    expect(formatUsd(0.0012)).toBe("$0.001200");
  });

  it("formats values between 1 and 1000 with 2 decimal places", () => {
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for under a minute", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
  });

  it("returns '1m ago' for exactly one minute", () => {
    expect(timeAgo(new Date(Date.now() - 60_000).toISOString())).toBe("1m ago");
  });

  it("returns 'Nm ago' for multiple minutes", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
  });
});

describe("computePriceChange", () => {
  it("returns null with fewer than two history points", () => {
    expect(computePriceChange([])).toBeNull();
    expect(computePriceChange([{ priceUsd: 1, capturedAt: new Date().toISOString() }])).toBeNull();
  });

  it("labels the change 'since first tracked' when total history spans under 24h", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 1.0, capturedAt: new Date(now - 60 * 60_000).toISOString() },
      { priceUsd: 1.2, capturedAt: new Date(now).toISOString() },
    ];
    const change = computePriceChange(history);
    expect(change).not.toBeNull();
    expect(change!.windowLabel).toBe("since first tracked");
    expect(change!.percent).toBeCloseTo(20);
  });

  it("labels the change '24h' and uses the earliest point within the last 24h as the reference when history spans more than a day", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 0.5, capturedAt: new Date(now - 30 * 60 * 60_000).toISOString() }, // 30h ago — outside window
      { priceUsd: 1.0, capturedAt: new Date(now - 20 * 60 * 60_000).toISOString() }, // 20h ago — reference
      { priceUsd: 1.5, capturedAt: new Date(now).toISOString() },
    ];
    const change = computePriceChange(history);
    expect(change).not.toBeNull();
    expect(change!.windowLabel).toBe("24h");
    expect(change!.percent).toBeCloseTo(50); // (1.5 - 1.0) / 1.0 * 100, not against the 30h-ago point
  });

  it("returns null when the reference price is zero", () => {
    const now = Date.now();
    const history = [
      { priceUsd: 0, capturedAt: new Date(now - 60 * 60_000).toISOString() },
      { priceUsd: 1, capturedAt: new Date(now).toISOString() },
    ];
    expect(computePriceChange(history)).toBeNull();
  });
});
