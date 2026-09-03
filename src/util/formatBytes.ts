/**
 * Formats a byte count as a human-readable size using binary (1024-based) maths and IEC unit
 * labels (B / KiB / MiB / GiB / TiB), with two decimals for scaled units.
 *
 * Examples: `0` → `"0 B"`, `512` → `"512 B"`, `966810` → `"944.15 KiB"`, `1048576` → `"1.00 MiB"`.
 *
 * Negative or non-finite inputs fall back to `"0 B"`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Bytes are whole; scaled units show two decimals.
  return unit === 0 ? `${value} B` : `${value.toFixed(2)} ${units[unit]}`;
}
