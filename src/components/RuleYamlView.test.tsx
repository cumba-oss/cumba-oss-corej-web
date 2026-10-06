import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders";
import { RuleYamlView } from "./RuleYamlView";
import { stringifyYaml } from "../util/toYaml";

/** A rule-shaped object. */
const RULE = {
  Description: "Verify dataset structure",
  Check: {
    all: [{ name: "RDOMAIN", operator: "is_not_null" }],
  },
};

/** Returns true if any rendered element's text content contains the substring. */
function hasText(substring: string): boolean {
  return screen.queryAllByText((_, el) => el?.textContent?.includes(substring) ?? false).length > 0;
}

describe("RuleYamlView", () => {
  it("renders an em-dash for a null value", () => {
    renderWithProviders(<RuleYamlView value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an em-dash for an undefined value", () => {
    renderWithProviders(<RuleYamlView value={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the action buttons and the YAML text", () => {
    renderWithProviders(<RuleYamlView value={RULE} />);
    expect(screen.getByRole("button", { name: "Expand all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy raw YAML" })).toBeInTheDocument();
    // CodeMirror renders the serialized YAML into its content area.
    expect(hasText("Description: Verify dataset structure")).toBe(true);
  });

  it("Expand all / Collapse all are clickable without error", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RuleYamlView value={RULE} />);
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    // No throw; the editor is still mounted.
    expect(screen.getByRole("button", { name: "Copy raw YAML" })).toBeInTheDocument();
  });

  it("Copy raw YAML writes the serialized YAML to the clipboard", async () => {
    // userEvent.setup() installs its own clipboard stub; override it AFTER so
    // our spy is the one Mantine's useClipboard reads at copy time.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderWithProviders(<RuleYamlView value={RULE} />);

    const copyBtn = screen.getByRole("button", { name: "Copy raw YAML" });
    await user.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(stringifyYaml(RULE));
    expect(await within(copyBtn).findByText("Copied")).toBeInTheDocument();
  });

  describe("colour scheme", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      window.localStorage.clear();
    });

    function viewOf(container: HTMLElement): EditorView {
      const dom = container.querySelector(".cm-editor");
      const view = dom && EditorView.findFromDOM(dom as HTMLElement);
      if (!view) throw new Error("no CodeMirror view");
      return view;
    }

    it("follows the COMPUTED scheme: auto on a dark OS gives the dark brand theme at first render", () => {
      // under "auto" useMantineColorScheme() answers "auto" — the old `=== "dark"` test rendered light
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const { container } = renderWithProviders(<RuleYamlView value={RULE} />);
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(true);
    });

    it("takes a stored dark choice", () => {
      window.localStorage.setItem("cumba-theme", "dark");
      const { container } = renderWithProviders(<RuleYamlView value={RULE} />);
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(true);
    });

    it("is light under auto with a light OS", () => {
      const { container } = renderWithProviders(<RuleYamlView value={RULE} />);
      expect(viewOf(container).state.facet(EditorView.darkTheme)).toBe(false);
    });
  });
});
