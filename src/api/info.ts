import { api, fail, ok, type ApiResult } from "./client";
import type { InfoT } from "./types";

/** GET /api/info — service name + version, shown in the footer as a health/identity check. */
export async function getInfo(): Promise<ApiResult<InfoT>> {
  const { data, error, response } = await api.GET("/api/info");
  return error || !data ? fail(error, response) : ok(data);
}
