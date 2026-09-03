import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { CheckRunStatusT } from "../api/types";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each<CheckRunStatusT>(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"])(
    "renders the %s lifecycle label",
    (status) => {
      const { getByText } = renderWithProviders(<StatusBadge status={status} />);
      expect(getByText(status)).toBeInTheDocument();
    },
  );

  it("renders an UNKNOWN badge when the status is absent", () => {
    const { getByText } = renderWithProviders(<StatusBadge status={undefined} />);
    expect(getByText("UNKNOWN")).toBeInTheDocument();
  });
});
