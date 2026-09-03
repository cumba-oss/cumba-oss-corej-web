import { Badge } from "@mantine/core";
import type { CheckRunStatusT } from "../api/types";

/** Mantine colour for each lifecycle state. */
const STATUS_COLORS: Record<CheckRunStatusT, string> = {
  PENDING: "gray",
  RUNNING: "blue",
  SUCCEEDED: "green",
  FAILED: "red",
  CANCELLED: "orange",
};

/** Props for {@link StatusBadge}. */
export interface StatusBadgeProps {
  /**
   * The run lifecycle state. May be `undefined` when a snapshot has not yet
   * reported a status; that renders a neutral "UNKNOWN" badge.
   */
  status?: CheckRunStatusT;
}

/**
 * Render a run's lifecycle state as a colour-coded Mantine {@link Badge}.
 * `PENDING → gray`, `RUNNING → blue`, `SUCCEEDED → green`, `FAILED → red`,
 * `CANCELLED → orange`. An absent/unknown status falls back to a gray
 * "UNKNOWN" badge so a row never renders blank.
 */
export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  if (!status) {
    return (
      <Badge color="gray" variant="light">
        UNKNOWN
      </Badge>
    );
  }
  return (
    <Badge color={STATUS_COLORS[status]} variant="light">
      {status}
    </Badge>
  );
}
