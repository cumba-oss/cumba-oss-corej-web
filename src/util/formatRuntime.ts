/**
 * Formats a millisecond runtime for display. Values of 1000 ms or more roll up to seconds with two
 * decimals; smaller values stay in milliseconds. A missing or "not measured" value (`null`,
 * `undefined`, or negative — the engine's `-1` sentinel) renders as an em dash.
 *
 * Examples: `-1` → `"—"`, `0` → `"0 ms"`, `250` → `"250 ms"`, `1000` → `"1.00 s"`,
 * `1500` → `"1.50 s"`.
 */
export function formatRuntime(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms} ms`;
}
