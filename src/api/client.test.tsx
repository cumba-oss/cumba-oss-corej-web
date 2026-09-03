import { describe, expect, it } from "vitest";
import { fail, ok, toProblem } from "./client";

describe("client error normalisation", () => {
  it("toProblem reads status + detail from a ProblemDetail body", () => {
    const res = new Response(null, { status: 409, statusText: "Conflict" });
    expect(toProblem({ status: 409, detail: "dup" }, res)).toEqual({ status: 409, detail: "dup" });
  });

  it("toProblem falls back to title when detail is absent", () => {
    const res = new Response(null, { status: 400, statusText: "Bad Request" });
    expect(toProblem({ status: 400, title: "Bad Request" }, res)).toEqual({
      status: 400,
      detail: "Bad Request",
    });
  });

  it("toProblem falls back to the response status + statusText for a non-problem body", () => {
    const res = new Response(null, { status: 502, statusText: "Bad Gateway" });
    expect(toProblem("oops", res)).toEqual({ status: 502, detail: "Bad Gateway" });
  });

  it("toProblem synthesises a detail when nothing is available", () => {
    const res = new Response(null, { status: 500 });
    expect(toProblem(undefined, res)).toEqual({ status: 500, detail: "Request failed (500)" });
  });

  it("ok and fail build the discriminated result", () => {
    expect(ok(42)).toEqual({ data: 42 });
    const res = new Response(null, { status: 404, statusText: "Not Found" });
    expect(fail(undefined, res)).toEqual({ problem: { status: 404, detail: "Not Found" } });
  });
});
