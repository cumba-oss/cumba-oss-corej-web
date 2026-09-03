import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import {
  conformance,
  datasetGroups,
  downloadLog,
  downloadReport,
  downloadReportV2,
  downloadReportXlsx,
  findings,
  getLog,
  logLines,
  rules,
} from "./results";

describe("results helpers", () => {
  it("datasetGroups returns the file → domain groups", async () => {
    const res = await datasetGroups("c-1");
    expect(res.data?.[0].fileName).toBe("dm.xpt");
    expect(res.data?.[0].domains?.[0].domain).toBe("DM");
  });

  it("datasetGroups maps a 409 not-succeeded to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/dataset-groups", () =>
        HttpResponse.json({ status: 409, detail: "Run did not succeed" }, { status: 409 }),
      ),
    );
    const res = await datasetGroups("c-1");
    expect(res.problem).toEqual({ status: 409, detail: "Run did not succeed" });
  });

  it("findings passes the scope filters and returns the page", async () => {
    let seen: Record<string, string | null> = {};
    server.use(
      http.get("/api/checks/:id/findings", ({ request }) => {
        const url = new URL(request.url);
        seen = {
          file: url.searchParams.get("file"),
          domain: url.searchParams.get("domain"),
          coreId: url.searchParams.get("coreId"),
          firstIndex: url.searchParams.get("firstIndex"),
        };
        return HttpResponse.json({ total: 1, firstIndex: 0, count: 1, items: [] });
      }),
    );
    const res = await findings("c-1", {
      file: "dm.xpt",
      domain: "DM",
      coreId: "R1",
      firstIndex: 0,
    });
    expect(seen).toMatchObject({ file: "dm.xpt", domain: "DM", coreId: "R1", firstIndex: "0" });
    expect(res.data?.total).toBe(1);
  });

  it("findings maps a 409 not-succeeded to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/findings", () =>
        HttpResponse.json({ status: 409, detail: "Run did not succeed" }, { status: 409 }),
      ),
    );
    const res = await findings("c-1", {});
    expect(res.problem?.status).toBe(409);
  });

  it("conformance returns the conformance block", async () => {
    const res = await conformance("c-1");
    expect(res.data?.standard).toBe("SDTMIG");
  });

  it("conformance maps a 409 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/conformance", () =>
        HttpResponse.json({ status: 409, detail: "Run did not succeed" }, { status: 409 }),
      ),
    );
    const res = await conformance("c-1");
    expect(res.problem?.status).toBe(409);
  });

  it("rules returns the per-rule outcomes", async () => {
    const res = await rules("c-1");
    expect(res.data?.[0].status).toBe("SOME_ISSUES");
  });

  it("rules maps a 409 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/rules", () =>
        HttpResponse.json({ status: 409, detail: "Run did not succeed" }, { status: 409 }),
      ),
    );
    const res = await rules("c-1");
    expect(res.problem?.status).toBe(409);
  });

  it("downloadReport returns a blob", async () => {
    server.use(
      http.get("/api/checks/:id/report", () =>
        HttpResponse.json({ conformance: {}, findings: [] }),
      ),
    );
    const res = await downloadReport("c-1");
    expect(res.problem).toBeUndefined();
    expect(res.data).toBeInstanceOf(Blob);
  });

  it("downloadReport maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/report", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await downloadReport("missing");
    expect(res.problem?.status).toBe(404);
  });

  it("downloadReportV2 returns a blob from /report-v2", async () => {
    server.use(
      http.get("/api/checks/:id/report-v2", () =>
        HttpResponse.json({ Report_Version: "2.0", Findings: [] }),
      ),
    );
    const res = await downloadReportV2("c-1");
    expect(res.problem).toBeUndefined();
    expect(res.data).toBeInstanceOf(Blob);
  });

  it("downloadReportV2 maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/report-v2", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await downloadReportV2("missing");
    expect(res.problem?.status).toBe(404);
  });

  it("downloadReportXlsx returns a blob from /report", async () => {
    server.use(http.get("/api/checks/:id/report", () => HttpResponse.json({ conformance: {} })));
    const res = await downloadReportXlsx("c-1");
    expect(res.problem).toBeUndefined();
    expect(res.data).toBeInstanceOf(Blob);
  });

  it("downloadReportXlsx maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/report", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await downloadReportXlsx("missing");
    expect(res.problem?.status).toBe(404);
  });

  it("getLog returns the structured run log", async () => {
    const res = await getLog("c-1");
    expect(res.problem).toBeUndefined();
    expect(res.data).toBeDefined();
  });

  it("getLog maps a 409 no-log to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/log", () =>
        HttpResponse.json({ status: 409, detail: "No log for this run" }, { status: 409 }),
      ),
    );
    const res = await getLog("c-1");
    expect(res.problem?.status).toBe(409);
  });

  it("downloadLog returns a blob from /log/file", async () => {
    server.use(http.get("/api/checks/:id/log/file", () => HttpResponse.text("log bytes")));
    const res = await downloadLog("c-1");
    expect(res.problem).toBeUndefined();
    expect(res.data).toBeInstanceOf(Blob);
  });

  it("downloadLog maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/log/file", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await downloadLog("missing");
    expect(res.problem?.status).toBe(404);
  });

  it("logLines passes the from cursor and returns the live page", async () => {
    let seenFrom: string | null = null;
    server.use(
      http.get("/api/checks/:id/log/lines", ({ request }) => {
        seenFrom = new URL(request.url).searchParams.get("from");
        return HttpResponse.json({ lines: ["INFO a", "INFO b"], nextFrom: 2, terminal: false });
      }),
    );
    const res = await logLines("c-1", 5);
    expect(seenFrom).toBe("5");
    expect(res.data?.lines).toEqual(["INFO a", "INFO b"]);
    expect(res.data?.nextFrom).toBe(2);
    expect(res.data?.terminal).toBe(false);
  });

  it("logLines defaults from to 0", async () => {
    let seenFrom: string | null = null;
    server.use(
      http.get("/api/checks/:id/log/lines", ({ request }) => {
        seenFrom = new URL(request.url).searchParams.get("from");
        return HttpResponse.json({ lines: [], nextFrom: 0, terminal: true });
      }),
    );
    await logLines("c-1");
    expect(seenFrom).toBe("0");
  });

  it("logLines maps a 404 unknown run to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/log/lines", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await logLines("missing");
    expect(res.problem?.status).toBe(404);
  });
});
