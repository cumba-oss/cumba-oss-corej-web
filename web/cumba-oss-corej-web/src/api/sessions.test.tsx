import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import {
  createSession,
  deleteAllSessionFiles,
  deleteSession,
  deleteSessionFile,
  listSessions,
  renameSession,
  uploadFile,
} from "./sessions";

describe("sessions helpers", () => {
  it("listSessions returns the typed session summaries", async () => {
    const res = await listSessions();
    expect(res.problem).toBeUndefined();
    expect(res.data?.[0].sessionId).toBe("s-1");
    expect(res.data?.[0].fileCount).toBe(2);
  });

  it("createSession returns the new session id", async () => {
    const res = await createSession();
    expect(res.data?.sessionId).toBe("s-1");
  });

  it("createSession sends a name body when given, and none when blank", async () => {
    const seen: (unknown | null)[] = [];
    server.use(
      http.post("/api/sessions", async ({ request }) => {
        const text = await request.text();
        seen.push(text ? JSON.parse(text) : null);
        return HttpResponse.json({ sessionId: "s-1", name: "My study" });
      }),
    );
    await createSession("  My study  ");
    await createSession("   ");
    await createSession();
    // Named create posts a trimmed name; blank/absent names post no body.
    expect(seen[0]).toEqual({ name: "My study" });
    expect(seen[1]).toBeNull();
    expect(seen[2]).toBeNull();
  });

  it("renameSession PATCHes the session and returns the updated summary", async () => {
    let seenMethod: string | null = null;
    let seenBody: unknown = null;
    server.use(
      http.patch("/api/sessions/:id", async ({ request }) => {
        seenMethod = request.method;
        seenBody = await request.json();
        return HttpResponse.json({ sessionId: "s-1", name: "Renamed", createdAt: "", files: [] });
      }),
    );
    const res = await renameSession("s-1", "Renamed");
    expect(seenMethod).toBe("PATCH");
    expect(seenBody).toEqual({ name: "Renamed" });
    expect(res.data?.name).toBe("Renamed");
  });

  it("renameSession maps a 400 invalid name to a problem", async () => {
    server.use(
      http.patch("/api/sessions/:id", () =>
        HttpResponse.json({ status: 400, detail: "Invalid session name" }, { status: 400 }),
      ),
    );
    const res = await renameSession("s-1", "x".repeat(201));
    expect(res.problem).toEqual({ status: 400, detail: "Invalid session name" });
  });

  it("uploadFile sends filename as a query param and returns metadata", async () => {
    let seenFilename: string | null = null;
    server.use(
      http.post("/api/sessions/:id/files", ({ request }) => {
        seenFilename = new URL(request.url).searchParams.get("filename");
        return HttpResponse.json(
          { sessionId: "s-1", filename: "dm.xpt", size: 5 },
          { status: 201 },
        );
      }),
    );
    const res = await uploadFile("s-1", "dm.xpt", new Blob(["hello"]));
    expect(seenFilename).toBe("dm.xpt");
    expect(res.data?.size).toBe(5);
  });

  it("uploadFile appends only the binary 'file' part, never a 'filename' form field", async () => {
    // Regression guard: when the name also rode in the multipart body, Spring's
    // @RequestParam merged the two values into a comma-joined "name,name". The
    // name must travel solely as the query param. (We assert on what the helper
    // appends, since the FormData body is not observable over the test transport.)
    const appendSpy = vi.spyOn(FormData.prototype, "append");
    server.use(
      http.post("/api/sessions/:id/files", () =>
        HttpResponse.json({ sessionId: "s-1", filename: "dm.xpt", size: 5 }, { status: 201 }),
      ),
    );
    await uploadFile("s-1", "dm.xpt", new Blob(["hello"]));
    const appendedKeys = appendSpy.mock.calls.map((call) => call[0]);
    expect(appendedKeys).toContain("file");
    expect(appendedKeys).not.toContain("filename");
    appendSpy.mockRestore();
  });

  it("uploadFile maps a 409 duplicate to a problem", async () => {
    server.use(
      http.post("/api/sessions/:id/files", () =>
        HttpResponse.json({ status: 409, detail: "Filename already present" }, { status: 409 }),
      ),
    );
    const res = await uploadFile("s-1", "dm.xpt", new Blob(["x"]));
    expect(res.data).toBeUndefined();
    expect(res.problem).toEqual({ status: 409, detail: "Filename already present" });
  });

  it("deleteSession returns ok on 204", async () => {
    const res = await deleteSession("s-1");
    expect(res.problem).toBeUndefined();
  });

  it("deleteSession maps a 409 in-flight to a problem", async () => {
    server.use(
      http.delete("/api/sessions/:id", () =>
        HttpResponse.json({ status: 409, detail: "Session has in-flight runs" }, { status: 409 }),
      ),
    );
    const res = await deleteSession("s-1");
    expect(res.problem).toEqual({ status: 409, detail: "Session has in-flight runs" });
  });

  it("deleteSessionFile targets the file path and returns ok on 204", async () => {
    let seenUrl: string | null = null;
    server.use(
      http.delete("/api/sessions/:id/files/:filename", ({ request }) => {
        seenUrl = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await deleteSessionFile("s-1", "dm.xpt");
    expect(seenUrl).toBe("/api/sessions/s-1/files/dm.xpt");
    expect(res.problem).toBeUndefined();
  });

  it("deleteSessionFile maps a 404 to a problem", async () => {
    server.use(
      http.delete("/api/sessions/:id/files/:filename", () =>
        HttpResponse.json({ status: 404, detail: "No such file" }, { status: 404 }),
      ),
    );
    const res = await deleteSessionFile("s-1", "missing.xpt");
    expect(res.problem).toEqual({ status: 404, detail: "No such file" });
  });

  it("deleteAllSessionFiles returns ok on 204", async () => {
    const res = await deleteAllSessionFiles("s-1");
    expect(res.problem).toBeUndefined();
  });

  it("deleteAllSessionFiles maps a 409 in-flight to a problem", async () => {
    server.use(
      http.delete("/api/sessions/:id/files", () =>
        HttpResponse.json({ status: 409, detail: "Session has in-flight runs" }, { status: 409 }),
      ),
    );
    const res = await deleteAllSessionFiles("s-1");
    expect(res.problem).toEqual({ status: 409, detail: "Session has in-flight runs" });
  });

  it("listSessions maps a 500 to a problem", async () => {
    server.use(
      http.get("/api/sessions", () =>
        HttpResponse.json({ status: 500, detail: "boom" }, { status: 500 }),
      ),
    );
    const res = await listSessions();
    expect(res.problem).toEqual({ status: 500, detail: "boom" });
  });
});
