import { useCallback, useMemo, useRef } from "react";
import { Box, Button, Group, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";
import { stringifyYaml } from "../util/toYaml";

export interface RuleYamlViewProps {
  /** The rule object (source or expanded). `null`/`undefined` renders an em-dash. */
  value: unknown;
}

/**
 * Read-only, syntax-highlighted, foldable YAML view of a rule definition.
 *
 * The sibling of {@link RuleJsonView}: same em-dash-on-null contract and the
 * same action row. Highlighting, the fold gutter, and code folding all come
 * from CodeMirror's `basicSetup`; Expand-all / Collapse-all drive the editor's
 * fold state via {@link unfoldAll} / {@link foldAll}, and Copy-raw-YAML copies
 * the serialized text. The editor is read-only — this is a viewer, not an
 * editor.
 */
export function RuleYamlView({ value }: RuleYamlViewProps): React.JSX.Element {
  const { colorScheme } = useMantineColorScheme();
  const clipboard = useClipboard({ timeout: 1500 });
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const text = useMemo(
    () => (value === null || value === undefined ? "" : stringifyYaml(value)),
    [value],
  );

  const expandAll = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) unfoldAll(view);
  }, []);
  const collapseAll = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) foldAll(view);
  }, []);

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
          onClick={() => clipboard.copy(text)}
        >
          {clipboard.copied ? "Copied" : "Copy raw YAML"}
        </Button>
      </Group>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <CodeMirror
          ref={editorRef}
          value={text}
          height="100%"
          style={{ height: "100%" }}
          editable={false}
          readOnly
          theme={colorScheme === "dark" ? "dark" : "light"}
          extensions={[yaml(), EditorView.lineWrapping]}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </Box>
    </Stack>
  );
}

export default RuleYamlView;
