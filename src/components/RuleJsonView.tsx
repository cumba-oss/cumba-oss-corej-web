import { useCallback, useMemo, useState } from "react";
import { Box, Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { JSONTree, type KeyPath, type ShouldExpandNodeInitially } from "react-json-tree";

/**
 * Top-level rule keys that open collapsed (bulky + uninteresting). Matched
 * ONLY at the top level (immediate child of the hidden root); deeper nodes
 * that happen to share the name stay expanded with the rest of the tree.
 */
const COLLAPSED_TOP_LEVEL_KEYS = new Set<string>(["Authorities"]);

/**
 * base16 palette for the tree, mapped onto the brand's code tokens (`--brand-code-*`, which carry
 * both colour schemes, so no `invertTheme`): base0D keys, base0B strings, base09 numbers — and
 * booleans, react-json-tree colours both with base09 — base08 null/undefined, base03 the item
 * counts, base00 the background, base05/07 the text. The remaining slots are unused by the tree's
 * value renderers and point at the nearest token.
 */
export const TREE_THEME = {
  scheme: "corej",
  base00: "var(--brand-code-bg)",
  base01: "var(--brand-surface-hover)",
  base02: "var(--brand-border)",
  base03: "var(--brand-code-comment)",
  base04: "var(--brand-text-dimmed)",
  base05: "var(--brand-code-fg)",
  base06: "var(--brand-code-fg)",
  base07: "var(--brand-code-fg)",
  base08: "var(--brand-code-keyword)",
  base09: "var(--brand-code-number)",
  base0A: "var(--brand-code-number)",
  base0B: "var(--brand-code-string)",
  base0C: "var(--brand-code-string)",
  base0D: "var(--brand-code-key)",
  base0E: "var(--brand-code-keyword)",
  base0F: "var(--brand-code-number)",
} as const;

export interface RuleJsonViewProps {
  /** The rule object (source or expanded). `null`/`undefined` renders an em-dash. */
  value: unknown;
}

/**
 * Interactive JSON tree for a rule definition: syntax-highlighted, foldable.
 *
 * Opens fully expanded EXCEPT the top-level `Authorities` node. Expand-all /
 * Collapse-all are driven by a `forced` state (`"open" | "closed" | null`)
 * that feeds the per-node expand decision; a `key` derived from `forced`
 * remounts the tree so the new default is re-applied (react-json-tree only
 * reads `shouldExpandNodeInitially` at mount, so a remount is the simplest,
 * library-internal-API-free way to drive all/none).
 */
export function RuleJsonView({ value }: RuleJsonViewProps): React.JSX.Element {
  const clipboard = useClipboard({ timeout: 1500 });
  const [forced, setForced] = useState<"open" | "closed" | null>(null);

  const expandAll = useCallback(() => setForced("open"), []);
  const collapseAll = useCallback(() => setForced("closed"), []);

  const shouldExpandNodeInitially = useMemo<ShouldExpandNodeInitially>(
    () => (keyPath: KeyPath, _data: unknown, level: number) => {
      if (forced === "open") return true;
      if (forced === "closed") return false;
      // Default: collapse only the exact top-level `Authorities` key. With the
      // root hidden, top-level nodes are at level 1 and their own key sits at
      // keyPath[0]; the trailing "root" entry is never matched.
      if (
        level === 1 &&
        typeof keyPath[0] === "string" &&
        COLLAPSED_TOP_LEVEL_KEYS.has(keyPath[0])
      ) {
        return false;
      }
      return true;
    },
    [forced],
  );

  if (value === null || value === undefined) {
    return <Text c="dimmed">—</Text>;
  }

  return (
    <Stack gap="xs" h="100%" style={{ minHeight: 0 }}>
      <Group gap="xs">
        <Button size="xs" variant="light" onClick={expandAll}>
          Expand all
        </Button>
        <Button size="xs" variant="light" onClick={collapseAll}>
          Collapse all
        </Button>
        <Button
          size="xs"
          variant="light"
          color={clipboard.copied ? "teal" : undefined}
          onClick={() => clipboard.copy(JSON.stringify(value, null, 2))}
        >
          {clipboard.copied ? "Copied" : "Copy raw JSON"}
        </Button>
      </Group>
      <ScrollArea type="auto" style={{ flex: 1, minHeight: 0 }}>
        <Box
          style={{
            fontFamily: "var(--mantine-font-family-monospace)",
            fontSize: "var(--mantine-font-size-sm)",
          }}
        >
          <JSONTree
            key={forced ?? "default"}
            data={value}
            hideRoot
            theme={TREE_THEME}
            invertTheme={false}
            shouldExpandNodeInitially={shouldExpandNodeInitially}
          />
        </Box>
      </ScrollArea>
    </Stack>
  );
}

export default RuleJsonView;
