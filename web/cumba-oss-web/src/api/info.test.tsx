import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { getInfo } from "./info";

describe("info helper", () => {
  it("getInfo returns the service name + version", async () => {
    const res = await getInfo();
    expect(res.problem).toBeUndefined();
    expect(res.data?.service).toBe("corej-cdisc-rest");
    expect(res.data?.version).toBe("1.2.3-TEST");
  });

  it("getInfo maps a 500 to a problem", async () => {
    server.use(
      http.get("/api/info", () =>
        HttpResponse.json({ status: 500, detail: "down" }, { status: 500 }),
      ),
    );
    const res = await getInfo();
    expect(res.data).toBeUndefined();
    expect(res.problem).toEqual({ status: 500, detail: "down" });
  });
});
