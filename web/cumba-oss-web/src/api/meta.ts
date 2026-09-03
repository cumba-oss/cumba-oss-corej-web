import { api, fail, ok, type ApiResult } from "./client";
import type { RuleOptionsT, RunOptionsT } from "./types";

/**
 * GET /api/meta/run-options — valid values for the run form: the selectable rule
 * PACKAGES (each with the CDISC Library standards it declares) and the
 * Define-XML version list.
 *
 * ⚑ A run names packages, not a standard + version — the former standards /
 * families / defaultFamily fields were removed with `-s` / `-v` / `-f`.
 */
export async function getRunOptions(): Promise<ApiResult<RunOptionsT>> {
  const { data, error, response } = await api.GET("/api/meta/run-options");
  return error || !data ? fail(error, response) : ok(data);
}

/**
 * GET /api/meta/rules?package= — the CORE rule ids (for include / exclude
 * selection) and any use-case tokens in one rule package.
 */
export async function getRuleOptions(packageName: string): Promise<ApiResult<RuleOptionsT>> {
  const { data, error, response } = await api.GET("/api/meta/rules", {
    params: { query: { package: packageName } },
  });
  return error || !data ? fail(error, response) : ok(data);
}
