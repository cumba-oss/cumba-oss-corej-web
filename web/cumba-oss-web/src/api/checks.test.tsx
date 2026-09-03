import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { awaitStatus, cancelCheck, deleteCheck, listChecks, startCheck } from "./checks";
import type { CheckRunRequestT } from "./types";

describe("checks helpers", () => {
  it("startCheck posts the request body and returns the run id", async () => {
    let seenBody: unknown;
    server.use(
      http.post("/api/sessions/:id/checks", async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ checkRunId: "c-1" }, { status: 201 });
      }),
    );
    const req: CheckRunRequestT = { rulesPackages: ["cdisc-sdtmig-3-4"] };
    const res = await startCheck("s-1", req);
    expect(seenBody).toEqual(req);
    expect(res.data?.checkRunId).toBe("c-1");
  });

  it("startCheck maps a 400 to a problem", async () => {
    server.use(
      http.post("/api/sessions/:id/checks", () =>
        HttpResponse.json({ status: 400, detail: "Invalid request" }, { status: 400 }),
      ),
    );
    const res = await startCheck("s-1", { rulesPackages: ["x"] });
    expect(res.problem).toEqual({ status: 400, detail: "Invalid request" });
  });

  it("listChecks returns the snapshots and is scopable by session", async () => {
    let seenSessionId: string | null = null;
    server.use(
      http.get("/api/checks", ({ request }) => {
        seenSessionId = new URL(request.url).searchParams.get("sessionId");
        return HttpResponse.json([{ checkRunId: "c-1", sessionId: "s-1", status: "RUNNING" }]);
      }),
    );
    const res = await listChecks("s-1");
    expect(seenSessionId).toBe("s-1");
    expect(res.data?.[0].status).toBe("RUNNING");
  });

  it("awaitStatus passes waitSeconds and returns the snapshot", async () => {
    let seenWait: string | null = null;
    server.use(
      http.get("/api/checks/:id/status", ({ request }) => {
        seenWait = new URL(request.url).searchParams.get("waitSeconds");
        return HttpResponse.json({ checkRunId: "c-1", status: "SUCCEEDED" });
      }),
    );
    const res = await awaitStatus("c-1", 20);
    expect(seenWait).toBe("20");
    expect(res.data?.status).toBe("SUCCEEDED");
  });

  it("awaitStatus omits waitSeconds when not given", async () => {
    let seenWait: string | null = "present";
    server.use(
      http.get("/api/checks/:id/status", ({ request }) => {
        seenWait = new URL(request.url).searchParams.get("waitSeconds");
        return HttpResponse.json({ checkRunId: "c-1", status: "PENDING" });
      }),
    );
    await awaitStatus("c-1");
    expect(seenWait).toBeNull();
  });

  it("awaitStatus maps a 404 to a problem", async () => {
    server.use(
      http.get("/api/checks/:id/status", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await awaitStatus("missing");
    expect(res.problem).toEqual({ status: 404, detail: "Unknown run" });
  });

  it("cancelCheck returns ok on 202", async () => {
    const res = await cancelCheck("c-1");
    expect(res.problem).toBeUndefined();
  });

  it("cancelCheck maps a 404 to a problem", async () => {
    server.use(
      http.post("/api/checks/:id/cancel", () =>
        HttpResponse.json({ status: 404, detail: "Unknown run" }, { status: 404 }),
      ),
    );
    const res = await cancelCheck("missing");
    expect(res.problem?.status).toBe(404);
  });

  it("deleteCheck returns ok on 204 and maps a 409 in-flight", async () => {
    const okRes = await deleteCheck("c-1");
    expect(okRes.problem).toBeUndefined();

    server.use(
      http.delete("/api/checks/:id", () =>
        HttpResponse.json({ status: 409, detail: "Run still in flight" }, { status: 409 }),
      ),
    );
    const res = await deleteCheck("c-1");
    expect(res.problem).toEqual({ status: 409, detail: "Run still in flight" });
  });
});
