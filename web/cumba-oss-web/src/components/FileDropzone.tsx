import { Group, Stack, Text } from "@mantine/core";
import { Dropzone, type FileWithPath } from "@mantine/dropzone";

/** Props for {@link FileDropzone}. */
export interface FileDropzoneProps {
  /**
   * Invoked with the dropped/selected files. The parent is responsible for
   * staging each file (one request per file) and surfacing per-file results.
   */
  onFiles: (files: FileWithPath[]) => void;
  /** Disable interaction (e.g. while a batch upload is in flight). */
  disabled?: boolean;
  /** Show the loading overlay (e.g. while a batch upload is in flight). */
  loading?: boolean;
}

/**
 * A thin wrapper over `@mantine/dropzone` for multi-file study uploads. It is
 * deliberately stateless: it hands the selected files to {@link FileDropzoneProps.onFiles}
 * and lets the owning view drive the actual `POST .../files` calls (one per
 * file) so per-file errors (e.g. a 409 duplicate) can be surfaced without
 * aborting the rest of the batch.
 */
export function FileDropzone({ onFiles, disabled, loading }: FileDropzoneProps): React.JSX.Element {
  return (
    <Dropzone
      onDrop={onFiles}
      disabled={disabled}
      loading={loading}
      multiple
      aria-label="Upload session files"
    >
      <Group justify="center" mih={100} style={{ pointerEvents: "none" }}>
        <Stack align="center" gap={4}>
          <Text size="sm" fw={500}>
            Drag study files here or click to select
          </Text>
          <Text size="xs" c="dimmed">
            Each file is uploaded individually; duplicates are reported per file.
          </Text>
        </Stack>
      </Group>
    </Dropzone>
  );
}
