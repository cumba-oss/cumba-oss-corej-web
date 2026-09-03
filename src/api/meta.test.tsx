import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { getRuleOptions, getRunOptions } from "./meta";

describe("meta helpers", () => {
  it("getRunOptions returns the typed run options", async () => {
    const res = await getRunOptions();
    expect(res.problem).toBeUndefined();
    expect(res.data).toEqual({ packages: [], defineVersions: [] });
  });

  it("getRunOptions maps a 500 to a problem", async () => {
    server.use(
      http.get("/api/meta/run-options", () =>
        HttpResponse.json({ status: 500, detail: "boom" }, { status: 500 }),
      ),
    );
    const res = await getRunOptions();
    expect(res.data).toBeUndefined();
    expect(res.problem).toEqual({ status: 500, detail: "boom" });
  });

  it("getRuleOptions passes the package name as a query param and returns rules", async () => {
    let seen: { package: string | null } | null = null;
    server.use(
      http.get("/api/meta/rules", ({ request }) => {
        const url = new URL(request.url);
        seen = { package: url.searchParams.get("package") };
        return HttpResponse.json({ rules: [], useCases: [] });
      }),
    );
    const res = await getRuleOptions("cdisc-sdtmig-3-4");
    expect(seen).toEqual({ package: "cdisc-sdtmig-3-4" });
    expect(res.data).toEqual({ rules: [], useCases: [] });
  });

  it("getRuleOptions maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/meta/rules", () =>
        HttpResponse.json({ status: 404, detail: "no such pack" }, { status: 404 }),
      ),
    );
    const res = await getRuleOptions("nope");
    expect(res.problem).toEqual({ status: 404, detail: "no such pack" });
  });
});
