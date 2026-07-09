import { describe, expect, it } from "vitest";
import { computeChartPolyline } from "./chart";

describe("computeChartPolyline", () => {
  it("returns an empty string for fewer than two points", () => {
    expect(computeChartPolyline([], 600, 120)).toBe("");
    expect(
      computeChartPolyline([{ priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" }], 600, 120)
    ).toBe("");
  });

  it("maps the lowest price to the bottom and the highest to the top", () => {
    const history = [
      { priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 2, capturedAt: "2026-01-01T01:00:00.000Z" },
    ];
    const [first, second] = computeChartPolyline(history, 600, 120).split(" ");
    expect(Number(first.split(",")[1])).toBe(120);
    expect(Number(second.split(",")[1])).toBe(0);
  });

  it("spaces points evenly across the width regardless of time gaps between them", () => {
    const history = [
      { priceUsd: 1, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 1, capturedAt: "2026-01-01T00:05:00.000Z" },
      { priceUsd: 1, capturedAt: "2026-01-02T00:00:00.000Z" },
    ];
    const xs = computeChartPolyline(history, 600, 120)
      .split(" ")
      .map((point) => Number(point.split(",")[0]));
    expect(xs).toEqual([0, 300, 600]);
  });

  it("draws a flat line when all prices are identical", () => {
    const history = [
      { priceUsd: 5, capturedAt: "2026-01-01T00:00:00.000Z" },
      { priceUsd: 5, capturedAt: "2026-01-01T01:00:00.000Z" },
    ];
    const ys = computeChartPolyline(history, 600, 120)
      .split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(ys[0]).toBe(120);
    expect(ys[1]).toBe(120);
  });
});
