import { describe, it, expect } from "vitest";
import { formatTimestamp } from "./formatTimestamp";

describe("formatTimestamp", () => {
  it("strips fractional seconds, keeping the Z suffix", () => {
    expect(formatTimestamp("2026-05-31T12:34:56.789Z")).toBe("2026-05-31T12:34:56Z");
  });

  it("strips fractional seconds, keeping a numeric offset", () => {
    expect(formatTimestamp("2026-05-31T12:34:56.789+02:00")).toBe("2026-05-31T12:34:56+02:00");
  });

  it("leaves an already-truncated timestamp unchanged", () => {
    expect(formatTimestamp("2026-05-31T12:34:56Z")).toBe("2026-05-31T12:34:56Z");
  });

  it("handles a timestamp with no zone", () => {
    expect(formatTimestamp("2026-05-31T12:34:56")).toBe("2026-05-31T12:34:56");
  });

  it("returns an em dash for empty / missing values", () => {
    expect(formatTimestamp(undefined)).toBe("—");
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp("")).toBe("—");
    expect(formatTimestamp("   ")).toBe("—");
  });

  it("returns an em dash for non-ISO / unparseable input", () => {
    expect(formatTimestamp("12.34 seconds")).toBe("—");
    expect(formatTimestamp("not a date")).toBe("—");
    // Date-only is not treated as a timestamp (no time component).
    expect(formatTimestamp("2026-05-31")).toBe("—");
  });

  it("rejects a syntactically-shaped but invalid instant", () => {
    expect(formatTimestamp("2026-13-45T99:99:99Z")).toBe("—");
  });
});
