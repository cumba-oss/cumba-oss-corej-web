import { describe, expect, it } from "vitest";
import { stringifyYaml } from "./toYaml";

describe("stringifyYaml", () => {
  it("serializes a nested object with 2-space indentation", () => {
    const yaml = stringifyYaml({ Core: { Id: "CORE-000001" }, Description: "DM rule" });
    expect(yaml).toContain("Core:\n  Id: CORE-000001");
    expect(yaml).toContain("Description: DM rule");
  });

  it("preserves key insertion order", () => {
    const yaml = stringifyYaml({ z: 1, a: 2, m: 3 });
    expect(yaml).toBe("z: 1\na: 2\nm: 3\n");
  });

  it("does not wrap long scalar values (lineWidth: 0)", () => {
    const long = "a".repeat(200);
    const yaml = stringifyYaml({ Expression: long });
    // The whole value stays on one physical line — no folded continuation.
    const valueLine = yaml.split("\n").find((l) => l.includes(long));
    expect(valueLine).toBeDefined();
  });

  it("renders arrays as block sequences", () => {
    const yaml = stringifyYaml({ items: ["RDOMAIN", "USUBJID"] });
    expect(yaml).toContain("items:\n  - RDOMAIN\n  - USUBJID");
  });
});
