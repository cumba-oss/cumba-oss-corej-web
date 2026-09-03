import { useCallback, useMemo, useState } from "react";
import { Box, Button, Group, ScrollArea, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { JSONTree, type KeyPath, type ShouldExpandNodeInitially } from "react-json-tree";

/**
 * Top-level rule keys that open collapsed (bulky + uninteresting). Matched
 * ONLY at the top level (immediate child of the hidden root); deeper nodes
 * that happen to share the name stay expanded with the rest of the tree.
 */
const COLLAPSED_TOP_LEVEL_KEYS = new Set<string>(["Authorities"]);

/**
 * base16 palette for the tree. react-json-tree ships dark base16 themes; we
 * supply an explicit one and flip it to a light variant via `invertTheme`
 * when Mantine is in light mode, so the colours track the app's colour scheme.
 */
const TREE_THEME = {
  scheme: "corej",
  base00: "transparent",
  base01: "#2a2c2e",
  base02: "#3a3d41",
  base03: "#6c7079",
  base04: "#969aa3",
  base05: "#c5c8c6",
  base06: "#e0e0e0",
  base07: "#ffffff",
  base08: "#fb4934",
  base09: "#fe8019",
  base0A: "#fabd2f",
  base0B: "#b8bb26",
  base0C: "#8ec07c",
  base0D: "#83a598",
  base0E: "#d3869b",
  base0F: "#d65d0e",
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
  const { colorScheme } = useMantineColorScheme();
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
            invertTheme={colorScheme !== "dark"}
            shouldExpandNodeInitially={shouldExpandNodeInitially}
          />
        </Box>
      </ScrollArea>
    </Stack>
  );
}

export default RuleJsonView;
