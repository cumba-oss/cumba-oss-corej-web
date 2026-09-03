import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { RuleJsonView } from "./RuleJsonView";

/** A rule-shaped object: top-level Authorities (collapsed by default) + Check (expanded). */
const RULE = {
  Description: "Verify dataset structure",
  Check: {
    all: [{ name: "RDOMAIN", operator: "is_not_null" }],
    nested_marker: "CHECK_LEAF_VALUE",
  },
  Authorities: [{ Organization: "CDISC", AUTHORITY_LEAF: "AUTH_LEAF_VALUE" }],
};

/** Returns true if any rendered text node contains the substring. */
function hasText(substring: string): boolean {
  return screen.queryAllByText((_, el) => el?.textContent?.includes(substring) ?? false).length > 0;
}

describe("RuleJsonView", () => {
  it("renders an em-dash for a null value", () => {
    renderWithProviders(<RuleJsonView value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an em-dash for an undefined value", () => {
    renderWithProviders(<RuleJsonView value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders interesting values and the action buttons", () => {
    renderWithProviders(<RuleJsonView value={RULE} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy raw JSON" })).toBeInTheDocument();
    // A top-level scalar is always visible.
    expect(hasText("Verify dataset structure")).toBe(true);
  });

  it("collapses top-level Authorities by default while Check stays expanded", () => {
    renderWithProviders(<RuleJsonView value={RULE} />);
    // Check is expanded → its nested leaf is in the DOM.
    expect(hasText("CHECK_LEAF_VALUE")).toBe(true);
    // Authorities is collapsed → its nested leaf is NOT rendered.
    expect(hasText("AUTH_LEAF_VALUE")).toBe(false);
    // The Authorities label itself is still present (just folded).
    expect(hasText("Authorities")).toBe(true);
  });

  it("Expand all reveals an Authorities child", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RuleJsonView value={RULE} />);
    expect(hasText("AUTH_LEAF_VALUE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(hasText("AUTH_LEAF_VALUE")).toBe(true);
  });

  it("Collapse all hides Check's content", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RuleJsonView value={RULE} />);
    expect(hasText("CHECK_LEAF_VALUE")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(hasText("CHECK_LEAF_VALUE")).toBe(false);
  });

  it("Copy raw JSON writes the pretty-printed JSON to the clipboard", async () => {
    // userEvent.setup() installs its own clipboard stub; override it AFTER so
    // our spy is the one Mantine's useClipboard reads at copy time.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderWithProviders(<RuleJsonView value={RULE} />);

    const copyBtn = screen.getByRole("button", { name: "Copy raw JSON" });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(RULE, null, 2));
    // Brief "Copied" affordance.
    expect(await within(copyBtn).findByText("Copied")).toBeInTheDocument();
  });
});
