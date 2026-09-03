import { describe, expect, it } from "vitest";
import { formatRuntime } from "./formatRuntime";

describe("formatRuntime", () => {
  it("renders sub-second values in milliseconds (0 is valid)", () => {
    expect(formatRuntime(0)).toBe("0 ms");
    expect(formatRuntime(250)).toBe("250 ms");
    expect(formatRuntime(999)).toBe("999 ms");
  });

  it("rolls up to seconds at 1000 ms and above", () => {
    expect(formatRuntime(1000)).toBe("1.00 s");
    expect(formatRuntime(1500)).toBe("1.50 s");
    expect(formatRuntime(12345)).toBe("12.35 s");
  });

  it("renders an em dash for not-measured / missing values", () => {
    expect(formatRuntime(-1)).toBe("—");
    expect(formatRuntime(null)).toBe("—");
    expect(formatRuntime(undefined)).toBe("—");
  });
});
