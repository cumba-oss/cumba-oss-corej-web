import { Anchor, Paper, Stack, Text } from "@mantine/core";

/** One bookmark entry: a stable `key` for the anchor id and a display `label`. */
export interface DatasetBookmark {
  /** Unique id of the dataset section (e.g. `<filename>#<domain>`). */
  key: string;
  /** Text shown for the jump link. */
  label: string;
}

/** Props for {@link DatasetBookmarks}. */
export interface DatasetBookmarksProps {
  /** Ordered dataset sections to render as jump links. */
  datasets: ReadonlyArray<DatasetBookmark>;
  /**
   * Builds the anchor id a link points at, from a bookmark's `key`. The caller
   * prefixes its anchors (e.g. `file-<name>`) so the ids stay unique on the page.
   */
  anchorId: (key: string) => string;
}

/**
 * A fixed (sticky) list of in-page jump links to per-section anchors. Stays put
 * while the content scrolls, so a section is always one click away. Used by the
 * Datasets tab to jump to each file's main group.
 */
export function DatasetBookmarks({
  datasets,
  anchorId,
}: DatasetBookmarksProps): React.JSX.Element | null {
  if (datasets.length === 0) return null;
  return (
    <Paper
      withBorder
      p="xs"
      style={{ position: "sticky", top: 0, alignSelf: "flex-start", minWidth: 160 }}
    >
      <Stack gap={4}>
        <Text size="xs" fw={600} c="dimmed">
          Datasets
        </Text>
        {datasets.map((d) => (
          <Anchor key={d.key} href={`#${anchorId(d.key)}`} size="sm">
            {d.label}
          </Anchor>
        ))}
      </Stack>
    </Paper>
  );
}
