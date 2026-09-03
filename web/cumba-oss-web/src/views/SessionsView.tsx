import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { FileWithPath } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import {
  createSession,
  deleteAllSessionFiles,
  deleteSession,
  deleteSessionFile,
  listSessions,
  renameSession,
  uploadFile,
  uploadFileFromUrl,
} from "../api/sessions";
import type { SessionSummaryT } from "../api/types";
import { FileDropzone } from "../components/FileDropzone";
import { formatBytes } from "../util/formatBytes";
import { formatTimestamp } from "../util/formatTimestamp";
import { NewRunView } from "./NewRunView";

/** Props for {@link SessionsView}. */
export interface SessionsViewProps {
  /** Called with the new check-run id when a run is started from a session. */
  onRunStarted?: (checkRunId: string) => void;
}

/**
 * Sessions workspace: list / create / delete sessions, upload study files
 * (one request per file, per-file 409 surfaced without aborting the batch),
 * and expand a session into an inline {@link NewRunView}.
 *
 * The staged files of each session — name, size and upload time — come from
 * the session-list endpoint and are rendered as a per-session table; their
 * names also feed {@link NewRunView} as `availableFiles`. After every upload
 * the list is refreshed, so the table is authoritative and survives reloads.
 */
export function SessionsView({ onRunStarted }: SessionsViewProps): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummaryT[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Create dialog: open state + the optional name being typed.
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  // Rename dialog: the session being renamed (null = closed), the value being typed, and whether
  // a rename request is in flight.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});
  const [urlSubmitting, setUrlSubmitting] = useState<string | null>(null);
  // In-flight file deletions: "<sessionId>/<filename>" for a single file, the
  // session id for a "delete all".
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [deletingAllFor, setDeletingAllFor] = useState<string | null>(null);
  // Per-session "files expanded?" state; collapsed by default.
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});

  const toggleFiles = useCallback((id: string) => {
    setOpenFiles((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, problem } = await listSessions();
    setLoading(false);
    if (problem) {
      notifications.show({
        color: "red",
        title: `Could not load sessions (${problem.status})`,
        message: problem.detail,
      });
      return;
    }
    setSessions(data ?? []);
  }, []);

  useEffect(() => {
    // Initial load of the session list (refresh shows a spinner, then fetches) — a legitimate
    // load-on-mount effect, so set-state-in-effect is suppressed for this call.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-mount with loading spinner
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    const { data, problem } = await createSession(createName);
    setCreating(false);
    if (problem) {
      notifications.show({
        color: "red",
        title: `Could not create session (${problem.status})`,
        message: problem.detail,
      });
      return;
    }
    setCreateOpen(false);
    setCreateName("");
    notifications.show({
      color: "green",
      title: "Session created",
      message: data?.name ?? data?.sessionId ?? "",
    });
    await refresh();
  }, [createName, refresh]);

  const handleRename = useCallback(async () => {
    if (renamingId === null) return;
    setRenameSubmitting(true);
    const { problem } = await renameSession(renamingId, renameValue);
    setRenameSubmitting(false);
    if (problem) {
      notifications.show({
        color: "red",
        title: `Could not rename session (${problem.status})`,
        message: problem.detail,
      });
      return;
    }
    setRenamingId(null);
    notifications.show({ color: "green", title: "Session renamed", message: renameValue.trim() });
    await refresh();
  }, [renamingId, renameValue, refresh]);

  const handleDelete = useCallback(
    async (sessionId: string) => {
      const { problem } = await deleteSession(sessionId);
      if (problem) {
        // 409 = the session still has in-flight runs; make that actionable.
        const title =
          problem.status === 409
            ? "Session has in-flight runs"
            : `Could not delete session (${problem.status})`;
        notifications.show({ color: "red", title, message: problem.detail });
        return;
      }
      if (expanded === sessionId) setExpanded(null);
      notifications.show({ color: "green", title: "Session deleted", message: sessionId });
      await refresh();
    },
    [expanded, refresh],
  );

  const handleUpload = useCallback(
    async (sessionId: string, files: FileWithPath[]) => {
      if (files.length === 0) return;
      setUploadingFor(sessionId);
      const accepted: string[] = [];
      try {
        // One request per file. A per-file failure (e.g. a 409 duplicate) is
        // surfaced but MUST NOT abort the remaining uploads in the batch.
        for (const file of files) {
          const name = file.name;
          const { data, problem } = await uploadFile(sessionId, name, file);
          if (problem) {
            const title =
              problem.status === 409
                ? `Duplicate file: ${name}`
                : `Upload failed: ${name} (${problem.status})`;
            notifications.show({ color: "red", title, message: problem.detail });
            continue;
          }
          accepted.push(data?.filename ?? name);
        }
      } finally {
        setUploadingFor(null);
      }
      if (accepted.length) {
        notifications.show({
          color: "green",
          title: "Files uploaded",
          message: `${accepted.length} file(s) staged`,
        });
      }
      await refresh();
    },
    [refresh],
  );

  const handleUploadUrl = useCallback(
    async (sessionId: string) => {
      const url = (urlInputs[sessionId] ?? "").trim();
      if (!url) return;
      setUrlSubmitting(sessionId);
      const { data, problem } = await uploadFileFromUrl(sessionId, url);
      setUrlSubmitting(null);
      if (problem) {
        notifications.show({
          color: "red",
          title: `Could not fetch URL (${problem.status})`,
          message: problem.detail,
        });
        return;
      }
      const name = data?.filename ?? url;
      setUrlInputs((prev) => ({ ...prev, [sessionId]: "" }));
      notifications.show({ color: "green", title: "File fetched", message: `Staged ${name}` });
      await refresh();
    },
    [urlInputs, refresh],
  );

  const handleDeleteFile = useCallback(
    async (sessionId: string, filename: string) => {
      setDeletingFile(`${sessionId}/${filename}`);
      const { problem } = await deleteSessionFile(sessionId, filename);
      setDeletingFile(null);
      if (problem) {
        const title =
          problem.status === 409
            ? "Session has in-flight runs"
            : `Could not delete file (${problem.status})`;
        notifications.show({ color: "red", title, message: problem.detail });
        return;
      }
      notifications.show({ color: "green", title: "File deleted", message: filename });
      await refresh();
    },
    [refresh],
  );

  const handleDeleteAllFiles = useCallback(
    async (sessionId: string) => {
      setDeletingAllFor(sessionId);
      const { problem } = await deleteAllSessionFiles(sessionId);
      setDeletingAllFor(null);
      if (problem) {
        const title =
          problem.status === 409
            ? "Session has in-flight runs"
            : `Could not delete files (${problem.status})`;
        notifications.show({ color: "red", title, message: problem.detail });
        return;
      }
      notifications.show({ color: "green", title: "All files deleted", message: sessionId });
      await refresh();
    },
    [refresh],
  );

  // Newest-first, id-tiebroken — defensive client-side ordering to match the server.
  const ordered = [...sessions].sort((a, b) => {
    const t = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return t !== 0 ? t : (a.sessionId ?? "").localeCompare(b.sessionId ?? "");
  });

  return (
    <Stack gap="md">
      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="New session" centered>
        <Stack gap="sm">
          <TextInput
            label="Name (optional)"
            placeholder="e.g. Study ABC-123"
            value={createName}
            data-autofocus
            onChange={(e) => setCreateName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} loading={creating}>
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={renamingId !== null}
        onClose={() => setRenamingId(null)}
        title="Rename session"
        centered
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            placeholder="Leave blank to clear the name"
            value={renameValue}
            data-autofocus
            onChange={(e) => setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRename();
            }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenamingId(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRename()} loading={renameSubmitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Group justify="space-between">
        <Title order={3}>Sessions</Title>
        <Button
          onClick={() => {
            setCreateName("");
            setCreateOpen(true);
          }}
        >
          New session
        </Button>
      </Group>

      {loading ? (
        <Group>
          <Loader size="sm" />
          <Text>Loading sessions…</Text>
        </Group>
      ) : sessions.length === 0 ? (
        <Text c="dimmed">No sessions yet. Create one to upload files and start a check.</Text>
      ) : (
        <Stack gap="sm">
          {ordered.map((session) => {
            const id = session.sessionId ?? "";
            const isExpanded = expanded === id;
            const files = session.files ?? [];
            const name = session.name ?? "";
            return (
              <Card key={id} withBorder padding="md">
                <Stack gap="sm">
                  <Table>
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>
                          {name ? (
                            <Stack gap={0}>
                              <Text fw={500}>{name}</Text>
                              <Text size="xs" c="dimmed">
                                {id}
                              </Text>
                            </Stack>
                          ) : (
                            <Text fw={500}>{id}</Text>
                          )}
                        </Table.Td>
                        <Table.Td>{formatTimestamp(session.createdAt)}</Table.Td>
                        <Table.Td>
                          {files.length > 0 ? (
                            <UnstyledButton
                              type="button"
                              onClick={() => toggleFiles(id)}
                              aria-label="Toggle file list"
                            >
                              <Badge variant="light" rightSection={openFiles[id] ? "▾" : "▸"}>
                                {session.fileCount ?? 0} file(s)
                              </Badge>
                            </UnstyledButton>
                          ) : (
                            <Badge variant="light">{session.fileCount ?? 0} file(s)</Badge>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Group justify="flex-end" gap="xs">
                            <Button
                              variant="light"
                              size="xs"
                              onClick={() => setExpanded(isExpanded ? null : id)}
                            >
                              {isExpanded ? "Hide new run" : "New run"}
                            </Button>
                            <Button
                              variant="subtle"
                              size="xs"
                              onClick={() => {
                                setRenameValue(name);
                                setRenamingId(id);
                              }}
                            >
                              Rename
                            </Button>
                            <Button
                              variant="outline"
                              color="red"
                              size="xs"
                              onClick={() => void handleDelete(id)}
                            >
                              Delete
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>

                  <FileDropzone
                    onFiles={(dropped) => void handleUpload(id, dropped)}
                    disabled={uploadingFor === id}
                    loading={uploadingFor === id}
                  />
                  <Group gap="xs" align="flex-end" wrap="nowrap">
                    <TextInput
                      style={{ flex: 1 }}
                      label="…or add a file by URL"
                      placeholder="https://example.com/data/dm.xpt"
                      value={urlInputs[id] ?? ""}
                      onChange={(e) =>
                        setUrlInputs((prev) => ({ ...prev, [id]: e.currentTarget.value }))
                      }
                    />
                    <Button
                      variant="light"
                      loading={urlSubmitting === id}
                      disabled={!(urlInputs[id] ?? "").trim()}
                      onClick={() => void handleUploadUrl(id)}
                    >
                      Fetch
                    </Button>
                  </Group>
                  {files.length > 0 && (
                    <Collapse expanded={openFiles[id] ?? false}>
                      <Stack gap="xs">
                        <Group justify="flex-end">
                          <Button
                            variant="outline"
                            color="red"
                            size="xs"
                            loading={deletingAllFor === id}
                            onClick={() => void handleDeleteAllFiles(id)}
                          >
                            Delete all files
                          </Button>
                        </Group>
                        <Table>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Name</Table.Th>
                              <Table.Th>Size</Table.Th>
                              <Table.Th>Uploaded</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {files.map((f) => {
                              const name = f.filename ?? "";
                              return (
                                <Table.Tr key={name}>
                                  <Table.Td>{name}</Table.Td>
                                  <Table.Td>{formatBytes(f.sizeBytes ?? 0)}</Table.Td>
                                  <Table.Td>{formatTimestamp(f.uploadedAt)}</Table.Td>
                                  <Table.Td style={{ textAlign: "right" }}>
                                    <Button
                                      variant="subtle"
                                      color="red"
                                      size="xs"
                                      loading={deletingFile === `${id}/${name}`}
                                      aria-label={`Delete ${name}`}
                                      onClick={() => void handleDeleteFile(id, name)}
                                    >
                                      Delete
                                    </Button>
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </Stack>
                    </Collapse>
                  )}

                  <Collapse expanded={isExpanded}>
                    <NewRunView
                      sessionId={id}
                      availableFiles={files.map((f) => f.filename ?? "")}
                      onStarted={(checkRunId) => {
                        setExpanded(null);
                        onRunStarted?.(checkRunId);
                      }}
                    />
                  </Collapse>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
