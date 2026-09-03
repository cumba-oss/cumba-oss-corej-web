import { stringify } from "yaml";

/**
 * Serialize a rule object to YAML text for the rule-definition overlay.
 *
 * Preserves key insertion order (so the YAML mirrors the JSON the API sent)
 * and disables line wrapping (`lineWidth: 0`) so long expressions / regexes
 * stay on a single line rather than being folded across multiple lines.
 */
export function stringifyYaml(value: unknown): string {
  return stringify(value, { indent: 2, lineWidth: 0 });
}
