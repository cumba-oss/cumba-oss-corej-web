import { useEffect, useState } from "react";
import { AppShell, Container, Switch, Tabs, Text, Title } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { SessionsView } from "./views/SessionsView";
import { RunsView } from "./views/RunsView";
import { ResultsView } from "./views/ResultsView";
import { getInfo } from "./api/info";
import type { CheckRunStatusT, InfoT } from "./api/types";

type TabValue = "sessions" | "runs" | "results";

/**
 * Max content width (px) when the user enables the wide layout. The default
 * `xl` container caps at 1320px and centres — fine on laptops, but it wastes a
 * lot of space on ultrawide monitors. Wide mode raises the cap to this value
 * (still centred + responsive below it, so narrow screens are unaffected).
 */
const WIDE_CONTAINER_WIDTH = 2400;

/** localStorage key persisting the wide-layout preference across reloads. */
const WIDE_LAYOUT_KEY = "corej-wide-layout";

/**
 * Application shell for the corej CDISC validation UI. Three tabs drive the
 * workflow: create/upload/start under {@link SessionsView}, watch live
 * progress under {@link RunsView}, and browse a succeeded run under
 * {@link ResultsView}. Starting a run jumps to Runs; picking a succeeded run
 * enables and opens Results. The footer surfaces the API's service/version
 * (`GET /api/info`) as a lightweight health check.
 */
export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabValue>("sessions");
  const [selectedRun, setSelectedRun] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<CheckRunStatusT | undefined>();
  const [info, setInfo] = useState<InfoT | undefined>();

  useEffect(() => {
    let active = true;
    void getInfo().then((result) => {
      if (active && result.data) setInfo(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const footer = info ? `${info.service ?? "corej"} ${info.version ?? ""}`.trim() : "";

  // Persisted layout preference: normal (xl, 1320px) vs wide (WIDE_CONTAINER_WIDTH).
  // The same size feeds all three regions so the header/footer stay aligned
  // with the main content.
  const [wideLayout, setWideLayout] = useLocalStorage<boolean>({
    key: WIDE_LAYOUT_KEY,
    defaultValue: false,
  });
  const containerSize = wideLayout ? WIDE_CONTAINER_WIDTH : "xl";

  return (
    <AppShell header={{ height: 56 }} footer={{ height: 36 }} padding="md">
      <AppShell.Header>
        <Container size={containerSize} h="100%" style={{ display: "flex", alignItems: "center" }}>
          <Title order={3}>corej CDISC validation</Title>
          <Switch
            ml="auto"
            size="sm"
            label="Wide layout"
            checked={wideLayout}
            onChange={(event) => setWideLayout(event.currentTarget.checked)}
          />
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size={containerSize}>
          <Tabs value={tab} onChange={(value) => setTab((value as TabValue | null) ?? "sessions")}>
            <Tabs.List>
              <Tabs.Tab value="sessions">Sessions</Tabs.Tab>
              <Tabs.Tab value="runs">Runs</Tabs.Tab>
              <Tabs.Tab value="results" disabled={!selectedRun}>
                Results
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="sessions" pt="md" keepMounted={false}>
              <SessionsView onRunStarted={() => setTab("runs")} />
            </Tabs.Panel>

            <Tabs.Panel value="runs" pt="md" keepMounted={false}>
              <RunsView
                onSelectRun={(checkRunId, status) => {
                  setSelectedRun(checkRunId);
                  setSelectedStatus(status);
                  setTab("results");
                }}
              />
            </Tabs.Panel>

            <Tabs.Panel value="results" pt="md" keepMounted={false}>
              {selectedRun ? (
                <ResultsView checkRunId={selectedRun} status={selectedStatus} />
              ) : (
                <Text c="dimmed">Select a run to view its results and log.</Text>
              )}
            </Tabs.Panel>
          </Tabs>
        </Container>
      </AppShell.Main>

      <AppShell.Footer>
        <Container size={containerSize} h="100%" style={{ display: "flex", alignItems: "center" }}>
          <Text size="xs" c="dimmed">
            {footer}
          </Text>
        </Container>
      </AppShell.Footer>
    </AppShell>
  );
}
