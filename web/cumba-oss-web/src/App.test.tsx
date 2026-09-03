import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test/renderWithProviders";
import App from "./App";

describe("App", () => {
  it("renders the shell and loads service info into the footer", async () => {
    renderWithProviders(<App />);
    expect(screen.getByText("corej CDISC validation")).toBeInTheDocument();
    expect(await screen.findByText(/corej-cdisc-rest/)).toBeInTheDocument();
  });

  it("toggles the wide layout and persists the preference", async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    renderWithProviders(<App />);
    const toggle = screen.getByRole("switch", { name: "Wide layout" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem("corej-wide-layout")).toBe("true");
  });

  it("keeps the Results tab disabled until a run is selected", async () => {
    renderWithProviders(<App />);
    const resultsTab = await screen.findByRole("tab", { name: "Results" });
    expect(resultsTab).toBeDisabled();
  });

  it("switches to the Runs tab when a run is started", async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(await screen.findByRole("tab", { name: "Runs" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("opens the Results tab when a succeeded run is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);

    await user.click(await screen.findByRole("tab", { name: "Runs" }));
    await user.click(await screen.findByRole("button", { name: "View results" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true"),
    );
  });
});
