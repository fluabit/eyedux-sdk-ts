import { describe, expect, it, vi } from "vitest";

import {
  EventEyeduxType,
  EyeduxClient,
  currentErrorSource,
  errorProperties,
} from "../src/index.js";

describe("diagnostics", () => {
  it("captures the calling source", () => {
    const source = currentErrorSource();

    expect(source?.file).toBe("diagnostics.test.ts");
    expect(source?.line).toBeGreaterThan(0);
  });

  it("copies and enriches properties without mutating the input", () => {
    const input = { request_id: "req-123" };
    const result = errorProperties(input, new Error("request failed"), "save");

    expect(result).toMatchObject({
      request_id: "req-123",
      error: "request failed",
      operation: "save",
      source_file: "diagnostics.test.ts",
    });
    expect(input).toEqual({ request_id: "req-123" });
  });

  it("emits enriched system errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "event-1" } }), {
        status: 201,
      }),
    );
    const client = new EyeduxClient("key", {
      projectId: "project",
      fetch: fetchMock,
    });
    const properties = { request_id: "req-123" };

    await client.emitError({
      type: "order.error",
      properties,
      error: new Error("request failed"),
      operation: "save order",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.eyedux_type).toBe(EventEyeduxType.SystemError);
    expect(body.properties).toMatchObject({
      request_id: "req-123",
      error: "request failed",
      operation: "save order",
    });
    expect(properties).toEqual({ request_id: "req-123" });
  });
});