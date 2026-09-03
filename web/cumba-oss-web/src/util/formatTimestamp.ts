/**
 * Normalises an ISO-8601 timestamp for display by stripping the fractional
 * seconds while keeping the rest of the ISO shape intact:
 *
 *   `2026-05-31T12:34:56.789Z` → `2026-05-31T12:34:56Z`
 *   `2026-05-31T12:34:56.789+02:00` → `2026-05-31T12:34:56+02:00`
 *   `2026-05-31T12:34:56` → `2026-05-31T12:34:56`
 *
 * Returns `"—"` for an empty/missing value or a string that does not look like
 * a parseable ISO timestamp.
 *
 * Intended for *known* timestamp fields only — it must not be applied blanket
 * to values such as `totalRuntime` ("12.34 seconds"), which it would mangle.
 */
export function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const trimmed = iso.trim();
  if (trimmed === "") return "—";
  // Require at least a date + time component (T HH:MM:SS) to treat it as ISO.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(.*)$/.exec(trimmed);
  if (!match) return "—";
  // Validate the underlying instant actually parses (rejects bogus dates).
  if (Number.isNaN(Date.parse(trimmed))) return "—";
  return `${match[1]}${match[2]}`;
}
