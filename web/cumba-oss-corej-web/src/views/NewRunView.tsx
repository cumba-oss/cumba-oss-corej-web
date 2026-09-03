import { useEffect, useState } from "react";
import {
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { startCheck } from "../api/checks";
import { getRuleOptions, getRunOptions } from "../api/meta";
import { getDefineVersion } from "../api/sessions";
import type { CheckRunRequestT, RuleOptionsT, RunOptionsT } from "../api/types";

/** Props for {@link NewRunView}. */
export interface NewRunViewProps {
  /** Session the check run will execute over. */
  sessionId: string;
  /**
   * Filenames the client uploaded into this session (the REST API does not
   * expose them). Used to populate the define-xml / rules / dataset-filter
   * pickers. When empty the pickers fall back to free-text entry so a user can
   * still name a file.
   */
  availableFiles: string[];
  /** Called with the new check-run id once the run has been queued. */
  onStarted?: (checkRunId: string) => void;
}

/** Shape of the Mantine form state. Strings/arrays/number, trimmed at submit. */
interface FormValues {
  /** Rule package short names, e.g. `cdisc-sdtmig-3-4`. At least one is required. */
  rulesPackages: string[];
  /**
   * ORDERED CDISC Library metadata products, e.g. `adam/adamig-1-3`. Highest
   * precedence first, and OPTIONAL (R4): empty means "the standards the selected
   * packages declare". Order is the whole point of the field, so the array order
   * is the value — never sorted for display.
   */
  metadataProducts: string[];
  useCase: string;
  defineXmlFilename: string;
  defineVersion: string;
  includeRules: string[];
  excludeRules: string[];
  rulesFilenames: string[];
  datasetFilter: string[];
  ruleThreads: number | "";
}

const initialValues: FormValues = {
  rulesPackages: [],
  metadataProducts: [],
  useCase: "",
  defineXmlFilename: "",
  defineVersion: "",
  includeRules: [],
  excludeRules: [],
  rulesFilenames: [],
  datasetFilter: [],
  ruleThreads: "",
};

/** Matches the auto-defaulted rules file names (`rules-*.json`, case-insensitive). */
const RULES_FILE_PATTERN = /^rules-.*\.json$/i;

/**
 * Map the form state to a {@link CheckRunRequestT}. Only the one required
 * field (`rulesPackages`) is always present; every optional field is included
 * only when it carries a non-empty value, so the request body stays minimal.
 *
 * Fix #217: `referenceDataFilenames` is deliberately NOT sent. A session is one
 * flat directory that *is* the data library, so a name given there resolves
 * inside it and is opened as a *library* — which makes the file a validation
 * target and hard-fails the run for Dataset-JSON / CSV / Parquet. `datasetFilter`
 * already expresses reference-data semantics correctly: a member the filter does
 * not name becomes a reference dataset, visible to cross-dataset rules and never
 * validated. The REST field itself stays on the published surface (freeze-v1);
 * this client simply stops driving it.
 */
function toRequest(values: FormValues): CheckRunRequestT {
  const req: CheckRunRequestT = {
    rulesPackages: values.rulesPackages,
  };
  if (values.metadataProducts.length) req.metadataProducts = values.metadataProducts;
  if (values.useCase.trim()) req.useCase = values.useCase.trim();
  if (values.defineXmlFilename.trim()) req.defineXmlFilename = values.defineXmlFilename.trim();
  if (values.defineVersion.trim()) req.defineVersion = values.defineVersion.trim();
  if (values.includeRules.length) req.includeRules = values.includeRules;
  if (values.excludeRules.length) req.excludeRules = values.excludeRules;
  if (values.rulesFilenames.length) req.rulesFilenames = values.rulesFilenames;
  if (values.datasetFilter.length) req.datasetFilter = values.datasetFilter;
  if (typeof values.ruleThreads === "number") req.ruleThreads = values.ruleThreads;
  return req;
}

/**
 * Move the item at `index` one place towards the front (`delta` -1) or back
 * (`delta` +1), returning a new array. Out-of-range moves return the input
 * unchanged, so the caller never has to guard the ends.
 */
function moveItem(items: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * A `@mantine/form` bound to {@link CheckRunRequestT}. At least one rules
 * package is required (validated inline) — a run names the packages it executes,
 * and each package declares the CDISC Library standard it resolves against. The non-free-text fields are populated from
 * the server's metadata endpoints (`/api/meta/run-options`, `/api/meta/rules`)
 * and rendered as dropdowns; file pickers are sourced from the session's
 * uploaded files. Every dropdown falls back to free-text entry when its option
 * source is empty (offline / empty rules dir), so the workflow is never blocked.
 * On submit it POSTs to `/api/sessions/{id}/checks` and reports the new run id.
 */
export function NewRunView({
  sessionId,
  availableFiles,
  onStarted,
}: NewRunViewProps): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [runOptions, setRunOptions] = useState<RunOptionsT | null>(null);
  const [ruleOptions, setRuleOptions] = useState<RuleOptionsT | null>(null);
  const form = useForm<FormValues>({
    initialValues,
    validate: {
      rulesPackages: (v, values) =>
        v.length || values.rulesFilenames.length
          ? null
          : "Select at least one rules package (or upload rule files)",
      // V4 (review R-7): a run whose rules come ONLY from uploaded rules files has no
      // package to declare its CDISC Library standard, so metadata products are required —
      // the server rejects the request (400) and the run was previously queued only to fail
      // asynchronously. rulesFilenames is AUTO-FILLED from any uploaded rules-*.json, so a
      // user reaches this shape without ever choosing it; the error must say what fixes it.
      metadataProducts: (v, values) =>
        values.rulesPackages.length === 0 && values.rulesFilenames.length > 0 && v.length === 0
          ? "Metadata products are required when rules come only from uploaded rules files (a rules file declares no CDISC Library standard)"
          : null,
      // Include XOR exclude — only one of the two rule filters may be set.
      includeRules: (v, values) =>
        v.length && values.excludeRules.length
          ? "Set either include or exclude rules, not both"
          : null,
      excludeRules: (v, values) =>
        v.length && values.includeRules.length
          ? "Set either include or exclude rules, not both"
          : null,
    },
  });

  // Load the run-form metadata once.
  useEffect(() => {
    let active = true;
    void getRunOptions().then((result) => {
      if (active && result.data) setRunOptions(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const { rulesPackages } = form.values;

  // Clear the rule options when the package selection empties — during render, not in an
  // effect (React's "adjust state when a prop changes" pattern).
  const selectionKey = rulesPackages.join(",");
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    if (rulesPackages.length === 0) setRuleOptions(null);
  }

  // Load the rule ids / use cases for every selected package and UNION them: the
  // include/exclude filters apply to the whole run, so offering only the first package's ids
  // would silently hide the rest.
  useEffect(() => {
    if (rulesPackages.length === 0) return;
    let active = true;
    void Promise.all(rulesPackages.map((name) => getRuleOptions(name))).then((results) => {
      if (!active) return;
      const byId = new Map<string, NonNullable<RuleOptionsT["rules"]>[number]>();
      const useCaseSet = new Set<string>();
      for (const result of results) {
        for (const rule of result.data?.rules ?? []) {
          if (rule.id && !byId.has(rule.id)) byId.set(rule.id, rule);
        }
        for (const useCase of result.data?.useCases ?? []) useCaseSet.add(useCase);
      }
      setRuleOptions({
        rules: [...byId.values()],
        useCases: [...useCaseSet].sort((a, b) => a.localeCompare(b)),
      });
    });
    return () => {
      active = false;
    };
  }, [selectionKey, rulesPackages]);

  const packageNames = (runOptions?.packages ?? []).map((p) => p.name ?? "").filter(Boolean);
  const defineVersions = (runOptions?.defineVersions ?? []).filter(Boolean);
  const productOptions = (runOptions?.metadataProducts ?? []).filter(Boolean);
  // Rule options carry id + description; the dropdown shows "ID — description".
  const ruleEntries = (ruleOptions?.rules ?? []).filter((r) => r.id);
  const ruleSelectData = ruleEntries.map((r) => ({
    value: r.id as string,
    label: r.description ? `${r.id} — ${r.description}` : (r.id as string),
  }));
  const ruleCount = ruleSelectData.length;
  const useCases = (ruleOptions?.useCases ?? []).filter(Boolean);

  const fileOptions = availableFiles;
  const hasFiles = fileOptions.length > 0;

  // Auto-default file pickers from the uploaded files: a file literally named
  // "define.xml" pre-selects the define.xml input, and every "rules-*.json"
  // pre-selects as a rules file. Only seeds empty fields, so a user's choice is
  // never overwritten.
  const setFieldValue = form.setFieldValue;
  useEffect(() => {
    if (form.values.defineXmlFilename === "" && availableFiles.includes("define.xml")) {
      setFieldValue("defineXmlFilename", "define.xml");
    }
    if (form.values.rulesFilenames.length === 0) {
      const packs = availableFiles.filter((f) => RULES_FILE_PATTERN.test(f));
      if (packs.length) setFieldValue("rulesFilenames", packs);
    }
    // Intentionally keyed on availableFiles only — re-seed when uploads change,
    // not on every keystroke (the empty-field guards keep it idempotent).
    // `form.setFieldValue` is intentionally NOT a dependency: Mantine v9 returns a new
    // function reference every render, so depending on it would re-run this effect each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableFiles]);

  // When a define.xml is selected, ask the server to detect its version from the
  // file content and set the define-version field automatically (always
  // overwrites). On an undeterminable file the field is left untouched and the
  // user is told detection failed. Re-runs whenever the selected file changes.
  useEffect(() => {
    const filename = form.values.defineXmlFilename.trim();
    if (!sessionId || !filename) return;
    let active = true;
    void getDefineVersion(sessionId, filename).then((result) => {
      if (!active) return;
      const detected = result.data?.defineVersion;
      if (detected) {
        setFieldValue("defineVersion", detected);
        notifications.show({
          color: "blue",
          message: `Detected Define-XML version ${result.data?.version ?? detected}; set automatically.`,
        });
      } else {
        notifications.show({
          color: "yellow",
          message: `Could not determine the Define-XML version of "${filename}".`,
        });
      }
    });
    return () => {
      active = false;
    };
    // `form.setFieldValue` is intentionally NOT a dependency: Mantine v9 returns a new function
    // reference every render, so depending on it would re-run this effect on every render — and
    // each run calls notifications.show(), whose store mutation re-renders, producing an infinite
    // render/notification loop. The effect must fire only when the selected file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.defineXmlFilename, sessionId]);

  // Count labels for the include/exclude pickers (Mantine v7 has no
  // valueComponent, so the summary is shown as the field description).
  const includeLabel =
    form.values.includeRules.length > 0
      ? `${form.values.includeRules.length} of ${ruleCount} rules selected`
      : "All rules selected";
  const excludeLabel =
    form.values.excludeRules.length > 0
      ? `${form.values.excludeRules.length} of ${ruleCount} rules selected`
      : "No rules selected";

  const handleSubmit = form.onSubmit(async (values) => {
    setSubmitting(true);
    try {
      const { data, problem } = await startCheck(sessionId, toRequest(values));
      if (problem) {
        notifications.show({
          color: "red",
          title: `Could not start check (${problem.status})`,
          message: problem.detail,
        });
        return;
      }
      notifications.show({
        color: "green",
        title: "Check started",
        message: `Run ${data?.checkRunId ?? ""} queued`,
      });
      if (data?.checkRunId) onStarted?.(data.checkRunId);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={handleSubmit} aria-label="New check run">
      <Stack gap="sm">
        <Title order={4}>New check run</Title>
        <Group grow align="flex-start">
          {packageNames.length > 0 ? (
            <MultiSelect
              label="Rules packages"
              placeholder="Select one or more packages"
              description="A package declares the CDISC Library standard it runs against"
              data={packageNames}
              withAsterisk
              searchable
              clearable
              {...form.getInputProps("rulesPackages")}
            />
          ) : (
            <TagsInput
              label="Rules packages"
              placeholder="cdisc-sdtmig-3-4"
              description="A package declares the CDISC Library standard it runs against"
              withAsterisk
              {...form.getInputProps("rulesPackages")}
            />
          )}
        </Group>
        {/*
          R4 — the ordered metadata-product list. OPTIONAL: left empty, the run resolves
          against the standards the selected packages declare (R7 adds each package's
          declared primary last). ORDER IS PRECEDENCE, highest first, so the control never
          sorts what the user picked: the MultiSelect appends in pick order and the arrows
          reorder explicitly.

          ⚑ Deviation from the plan's "drag-to-reorder": Mantine ships no drag-and-drop
          primitive, so that wording would mean adding a runtime DnD dependency to the SPA
          for a nicety. Explicit move-up / move-down buttons express exactly the same
          ordering, and are keyboard-reachable and directly testable.
        */}
        <Stack gap={4}>
          {productOptions.length > 0 ? (
            <MultiSelect
              label="Metadata products"
              placeholder="Select (optional) — highest precedence first"
              description="Ordered CDISC Library products consulted for metadata. Metadata only: rules come from the packages above."
              data={productOptions}
              searchable
              clearable
              {...form.getInputProps("metadataProducts")}
            />
          ) : (
            <TagsInput
              label="Metadata products"
              placeholder="adam/adamig-1-3"
              description="Ordered CDISC Library products consulted for metadata. Metadata only: rules come from the packages above."
              {...form.getInputProps("metadataProducts")}
            />
          )}
          {form.values.metadataProducts.length > 1 && (
            <Stack gap={2}>
              {form.values.metadataProducts.map((product, index) => (
                <Group key={product} gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={16}>
                    {index + 1}
                  </Text>
                  <Text size="xs" style={{ flex: 1 }}>
                    {product}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    aria-label={`Move ${product} earlier`}
                    disabled={index === 0}
                    onClick={() =>
                      form.setFieldValue(
                        "metadataProducts",
                        moveItem(form.values.metadataProducts, index, -1),
                      )
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    aria-label={`Move ${product} later`}
                    disabled={index === form.values.metadataProducts.length - 1}
                    onClick={() =>
                      form.setFieldValue(
                        "metadataProducts",
                        moveItem(form.values.metadataProducts, index, 1),
                      )
                    }
                  >
                    ↓
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
        <Group grow align="flex-start">
          {useCases.length > 0 ? (
            <Select
              label="Use case"
              placeholder="Select (optional)"
              data={useCases}
              clearable
              {...form.getInputProps("useCase")}
            />
          ) : (
            <TextInput label="Use case" {...form.getInputProps("useCase")} />
          )}
        </Group>

        {hasFiles ? (
          <Select
            label="Define.xml file"
            placeholder="Select an uploaded file"
            data={fileOptions}
            clearable
            {...form.getInputProps("defineXmlFilename")}
          />
        ) : (
          <TextInput
            label="Define.xml file"
            placeholder="Name an uploaded file"
            {...form.getInputProps("defineXmlFilename")}
          />
        )}
        {defineVersions.length > 0 ? (
          <Select
            label="Define version"
            placeholder="Select (optional)"
            data={defineVersions}
            clearable
            {...form.getInputProps("defineVersion")}
          />
        ) : (
          <TextInput label="Define version" {...form.getInputProps("defineVersion")} />
        )}

        <Group grow align="flex-start">
          {ruleCount > 0 ? (
            <MultiSelect
              label="Include rules"
              placeholder="Search rules to include"
              description={includeLabel}
              data={ruleSelectData}
              searchable
              clearable
              {...form.getInputProps("includeRules")}
            />
          ) : (
            <TagsInput
              label="Include rules"
              placeholder="CORE rule ids"
              description={includeLabel}
              {...form.getInputProps("includeRules")}
            />
          )}
          {ruleCount > 0 ? (
            <MultiSelect
              label="Exclude rules"
              placeholder="Search rules to exclude"
              description={excludeLabel}
              data={ruleSelectData}
              searchable
              clearable
              {...form.getInputProps("excludeRules")}
            />
          ) : (
            <TagsInput
              label="Exclude rules"
              placeholder="CORE rule ids"
              description={excludeLabel}
              {...form.getInputProps("excludeRules")}
            />
          )}
        </Group>

        {hasFiles ? (
          <MultiSelect
            label="Rules files"
            placeholder="Select uploaded rule packs"
            data={fileOptions}
            clearable
            {...form.getInputProps("rulesFilenames")}
          />
        ) : (
          <TagsInput
            label="Rules files"
            placeholder="Type a file name and press Enter"
            {...form.getInputProps("rulesFilenames")}
          />
        )}

        {/*
          Reference data: there is no separate control. Name the datasets to validate
          here — every other uploaded member becomes a reference dataset, visible to
          cross-dataset rules but never validated. See toRequest above (Fix #217).
        */}
        {hasFiles ? (
          <MultiSelect
            label="Dataset filter"
            placeholder="Select uploaded files"
            description="Members not listed here are loaded as reference data only"
            data={fileOptions}
            clearable
            {...form.getInputProps("datasetFilter")}
          />
        ) : (
          <TagsInput
            label="Dataset filter"
            placeholder="Dataset/domain names"
            description="Members not listed here are loaded as reference data only"
            {...form.getInputProps("datasetFilter")}
          />
        )}
        <NumberInput
          label="Rule threads"
          placeholder="1"
          min={1}
          allowDecimal={false}
          {...form.getInputProps("ruleThreads")}
        />

        <Group justify="flex-end">
          <Button type="submit" loading={submitting}>
            Start check
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
