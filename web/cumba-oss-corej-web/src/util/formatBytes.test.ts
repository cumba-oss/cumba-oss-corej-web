import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("renders bytes without decimals", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales to IEC units with two decimals", () => {
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(966810)).toBe("944.15 KiB");
    expect(formatBytes(1048576)).toBe("1.00 MiB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.00 GiB");
  });

  it("falls back to 0 B for non-positive or non-finite input", () => {
    expect(formatBytes(-10)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});
