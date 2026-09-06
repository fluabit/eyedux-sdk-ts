import { describe, expect, it, vi } from "vitest";

import {
  APIErrorCode,
  EventEyeduxType,
  EyeduxAPIError,
  EyeduxClient,
  EyeduxRequestError,
  createEyeduxClientWithConfig,
  isAuthError,
  isConflict,
  isExternalObjectConflict,
  isNotFound,
  isRateLimited,
} from "../src/index.js";

const apiEvent = {
  id: "abc123",
  environment: "production",
  eyedux_type: "system-log",
  type: "user.signup",
  type_group: "identity",
  properties: { plan: "pro" },
  status: "active",
  timestamp: "2026-08-13T10:00:00Z",
  created_at: "2026-08-13T10:00:01Z",
  external_object: null,
  correlation_object: null,
  metadata: { service: "api" },
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("EyeduxClient", () => {
  it("rejects an empty API key", () => {
    expect(() => new EyeduxClient("  ")).toThrowError(
      expect.objectContaining({ code: "EMPTY_API_KEY" }),
    );
  });

  it("requires a project in explicit configuration", () => {
    expect(() =>
      createEyeduxClientWithConfig({ apiKey: "key", projectId: " " }),
    ).toThrowError(
      expect.objectContaining({
        code: "EMPTY_PROJECT_ID",
      }),
    );
  });

  it("creates an event with defaults, overrides, and mapped response fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: apiEvent }, 201),
    );
    const defaultMetadata = { service: "eyedux", environment: "test" };
    const client = new EyeduxClient(" test-api-key ", {
      projectId: " default-project ",
      defaultMetadata,
      fetch: fetchMock,
    });
    defaultMetadata.service = "mutated";

    const event = await client.createEvent({
      type: "user.signup",
      typeGroup: "identity",
      eyeduxType: EventEyeduxType.SystemLog,
      properties: { plan: "pro" },
      externalObject: { id: "evt-1", property: "orderId" },
      metadata: { service: "api" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.eyedux.com/public/logs");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer test-api-key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      project_id: "default-project",
      type: "user.signup",
      type_group: "identity",
      eyedux_type: "system-log",
      properties: { plan: "pro" },
      external_object: { id: "evt-1", property: "orderId" },
      metadata: { service: "api", environment: "test" },
    });
    expect(event).toEqual({
      id: "abc123",
      environment: "production",
      eyeduxType: "system-log",
      type: "user.signup",
      typeGroup: "identity",
      properties: { plan: "pro" },
      status: "active",
      timestamp: "2026-08-13T10:00:00Z",
      createdAt: "2026-08-13T10:00:01Z",
      externalObject: null,
      correlationObject: null,
      metadata: { service: "api" },
    });
  });

  it("prefers an explicit project and omits absent optional fields", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { id: "event-1" } }, 201));
    const client = new EyeduxClient("key", {
      projectId: "default-project",
      fetch: fetchMock,
    });

    await client.createEvent({
      projectId: " explicit-project ",
      type: "api.request",
      properties: { method: "GET" },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body).toEqual({
      project_id: "explicit-project",
      type: "api.request",
      properties: { method: "GET" },
    });
  });

  it("rejects event creation without a project before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new EyeduxClient("key", { fetch: fetchMock });

    await expect(
      client.createEvent({ type: "event", properties: { ok: true } }),
    ).rejects.toMatchObject({ code: "EMPTY_PROJECT_ID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists events with cumulative encoded filters", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [apiEvent] }));
    const client = new EyeduxClient("key", { fetch: fetchMock });

    const events = await client.listEvents({
      type: "user signup",
      correlationId: "session/a",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.eyedux.com/public/logs?type=user+signup&correlation_id=session%2Fa",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("abc123");
  });

  it("normalizes null list data to an empty array", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: null }));
    const client = new EyeduxClient("key", { fetch: fetchMock });

    await expect(client.listEvents()).resolves.toEqual([]);
  });

  it("finds an event by an encoded external ID", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: apiEvent }));
    const client = new EyeduxClient("key", { fetch: fetchMock });

    await client.findEventByExternalId("order/123");

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.eyedux.com/public/logs/external/order%2F123",
    );
    await expect(client.findEventByExternalId("")).rejects.toMatchObject({
      code: "EMPTY_EXTERNAL_ID",
    });
  });

  it("returns structured API errors and retry information", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: APIErrorCode.RateLimitExceeded,
            message: "too many requests",
          },
        },
        429,
        { "Retry-After": "3" },
      ),
    );
    const client = new EyeduxClient("key", { fetch: fetchMock });

    const error = await client.listEvents().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EyeduxAPIError);
    expect(error).toMatchObject({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      apiMessage: "too many requests",
      retryAfter: 3,
    });
    expect(isRateLimited(error)).toBe(true);
  });

  it("preserves the status for malformed API errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream failure", { status: 502 }));
    const client = new EyeduxClient("key", { fetch: fetchMock });

    await expect(client.listEvents()).rejects.toMatchObject({
      statusCode: 502,
      code: "",
    });
  });

  it("rejects malformed successful responses as request errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{", { status: 200 }));
    const client = new EyeduxClient("key", { fetch: fetchMock });

    await expect(client.listEvents()).rejects.toBeInstanceOf(EyeduxRequestError);
  });

  it("forwards an already-aborted signal to fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(init?.signal?.reason);
    });
    const client = new EyeduxClient("key", { fetch: fetchMock });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      client.listEvents({}, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(EyeduxRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["emitWarning", EventEyeduxType.SystemWarning],
    ["emitLog", EventEyeduxType.SystemLog],
    ["emitDebug", EventEyeduxType.SystemDebug],
    ["emitInfo", EventEyeduxType.SystemInfo],
    ["emitMetric", EventEyeduxType.SystemMetric],
  ] as const)("%s uses %s", async (method, expectedType) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { id: "event-1" } }, 201));
    const client = new EyeduxClient("key", {
      projectId: "project",
      fetch: fetchMock,
    });

    await client[method]({ type: "api.event", properties: { ok: true } });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.eyedux_type).toBe(expectedType);
  });
});

describe("error helpers", () => {
  it("classifies API errors", () => {
    expect(isNotFound(new EyeduxAPIError(404, "", ""))).toBe(true);
    expect(isConflict(new EyeduxAPIError(409, "", ""))).toBe(true);
    expect(
      isExternalObjectConflict(
        new EyeduxAPIError(
          409,
          APIErrorCode.EventExternalObjectConflict,
          "duplicate",
        ),
      ),
    ).toBe(true);
    expect(
      isAuthError(
        new EyeduxAPIError(422, APIErrorCode.InvalidAPIKey, "invalid"),
      ),
    ).toBe(true);
    expect(isNotFound(undefined)).toBe(false);
  });
});