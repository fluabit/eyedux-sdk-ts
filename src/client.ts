import { errorPropertiesWithSourceSkip } from "./diagnostics.js";
import {
  EyeduxAPIError,
  EyeduxRequestError,
  EyeduxValidationError,
} from "./errors.js";
import {
  EventEyeduxType,
  type CreateEventInput,
  type EmitInput,
  type EyeduxClientConfig,
  type EyeduxClientOptions,
  type EyeduxEvent,
  type JsonObject,
  type ListEventsInput,
  type RequestOptions,
} from "./types.js";

const BASE_URL = "https://api.eyedux.com";
const DEFAULT_TIMEOUT_MS = 30_000;

interface APIEvent {
  id: string;
  environment?: string;
  eyedux_type?: EventEyeduxType | null;
  type?: string;
  type_group?: string;
  properties?: JsonObject;
  status?: "active" | "deleted";
  timestamp?: string;
  created_at?: string;
  external_object?: EyeduxEvent["externalObject"];
  correlation_object?: EyeduxEvent["correlationObject"];
  metadata?: JsonObject | null;
}

interface SuccessEnvelope<T> {
  data: T;
}

export class EyeduxClient {
  readonly #apiKey: string;
  readonly #projectId: string | undefined;
  readonly #timeoutMs: number;
  readonly #defaultMetadata: JsonObject | undefined;
  readonly #fetch: typeof globalThis.fetch;

  constructor(apiKey: string, options: EyeduxClientOptions = {}) {
    const normalizedAPIKey = apiKey.trim();
    if (!normalizedAPIKey) {
      throw new EyeduxValidationError(
        "EMPTY_API_KEY",
        "eyedux: api key must not be empty",
      );
    }

    this.#apiKey = normalizedAPIKey;
    this.#projectId = options.projectId?.trim() || undefined;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#defaultMetadata = options.defaultMetadata
      ? { ...options.defaultMetadata }
      : undefined;
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (!this.#fetch) {
      throw new EyeduxRequestError(
        "fetch is unavailable; provide options.fetch or use Node.js 18+",
      );
    }
  }

  async createEvent(
    input: CreateEventInput,
    options: RequestOptions = {},
  ): Promise<EyeduxEvent> {
    const projectId = input.projectId?.trim() || this.#projectId;
    if (!projectId) {
      throw new EyeduxValidationError(
        "EMPTY_PROJECT_ID",
        "eyedux: project id must not be empty",
      );
    }

    const body: Record<string, unknown> = {
      project_id: projectId,
      type: input.type,
      properties: input.properties,
    };
    if (input.typeGroup) body.type_group = input.typeGroup;
    if (input.eyeduxType) body.eyedux_type = input.eyeduxType;
    if (input.externalObject) body.external_object = input.externalObject;
    if (input.correlationObject) {
      body.correlation_object = input.correlationObject;
    }

    const metadata = { ...this.#defaultMetadata, ...input.metadata };
    if (Object.keys(metadata).length > 0) body.metadata = metadata;

    const response = await this.#request<SuccessEnvelope<APIEvent>>(
      "/public/logs",
      { method: "POST", body: JSON.stringify(body) },
      options,
    );
    return mapEvent(response.data);
  }

  async listEvents(
    input: ListEventsInput = {},
    options: RequestOptions = {},
  ): Promise<EyeduxEvent[]> {
    const query = new URLSearchParams();
    if (input.type !== undefined) query.set("type", input.type);
    if (input.correlationId !== undefined) {
      query.set("correlation_id", input.correlationId);
    }
    const suffix = query.size > 0 ? `?${query}` : "";
    const response = await this.#request<SuccessEnvelope<APIEvent[] | null>>(
      `/public/logs${suffix}`,
      { method: "GET" },
      options,
    );
    return (response.data ?? []).map(mapEvent);
  }

  async findEventByExternalId(
    externalId: string,
    options: RequestOptions = {},
  ): Promise<EyeduxEvent> {
    if (!externalId) {
      throw new EyeduxValidationError(
        "EMPTY_EXTERNAL_ID",
        "eyedux: external_id must not be empty",
      );
    }
    const response = await this.#request<SuccessEnvelope<APIEvent>>(
      `/public/logs/external/${encodeURIComponent(externalId)}`,
      { method: "GET" },
      options,
    );
    return mapEvent(response.data);
  }

  emit(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.createEvent(input, options);
  }

  emitError(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.createEvent(
      {
        ...input,
        eyeduxType: EventEyeduxType.SystemError,
        properties: errorPropertiesWithSourceSkip(
          input.properties,
          input.error,
          input.operation,
          input.sourceSkip,
        ),
      },
      options,
    );
  }

  emitWarning(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.#emitAs(EventEyeduxType.SystemWarning, input, options);
  }

  emitLog(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.#emitAs(EventEyeduxType.SystemLog, input, options);
  }

  emitDebug(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.#emitAs(EventEyeduxType.SystemDebug, input, options);
  }

  emitInfo(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.#emitAs(EventEyeduxType.SystemInfo, input, options);
  }

  emitMetric(input: EmitInput, options?: RequestOptions): Promise<EyeduxEvent> {
    return this.#emitAs(EventEyeduxType.SystemMetric, input, options);
  }

  #emitAs(
    eyeduxType: EventEyeduxType,
    input: EmitInput,
    options?: RequestOptions,
  ): Promise<EyeduxEvent> {
    return this.createEvent({ ...input, eyeduxType }, options);
  }

  async #request<T>(
    path: string,
    init: RequestInit,
    options: RequestOptions,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) throw parseAPIError(response, raw);

      try {
        return JSON.parse(raw) as T;
      } catch (error) {
        throw new EyeduxRequestError("decode response", { cause: error });
      }
    } catch (error) {
      if (error instanceof EyeduxAPIError || error instanceof EyeduxRequestError) {
        throw error;
      }
      throw new EyeduxRequestError("execute request", { cause: error });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createEyeduxClient(
  apiKey: string,
  options?: EyeduxClientOptions,
): EyeduxClient {
  return new EyeduxClient(apiKey, options);
}

export function createEyeduxClientWithConfig(
  config: EyeduxClientConfig,
): EyeduxClient {
  if (!config.projectId.trim()) {
    throw new EyeduxValidationError(
      "EMPTY_PROJECT_ID",
      "eyedux: project id must not be empty",
    );
  }
  return new EyeduxClient(config.apiKey, config);
}

export function createEyeduxClientFromEnv(
  options?: EyeduxClientOptions,
): EyeduxClient {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return new EyeduxClient(runtime.process?.env?.EYEDUX_API_KEY ?? "", options);
}

function mapEvent(event: APIEvent): EyeduxEvent {
  return {
    id: event.id,
    environment: event.environment ?? "",
    eyeduxType: event.eyedux_type ?? null,
    type: event.type ?? "",
    typeGroup: event.type_group ?? "",
    properties: event.properties ?? {},
    status: event.status ?? "active",
    timestamp: event.timestamp ?? "",
    createdAt: event.created_at ?? "",
    externalObject: event.external_object ?? null,
    correlationObject: event.correlation_object ?? null,
    metadata: event.metadata ?? null,
  };
}

function parseAPIError(response: Response, raw: string): EyeduxAPIError {
  let code = "";
  let message = "";
  try {
    const body = JSON.parse(raw) as {
      error?: { code?: string; message?: string };
    };
    code = body.error?.code ?? "";
    message = body.error?.message ?? "";
  } catch {
    // A malformed error body still retains the HTTP status.
  }

  const retryAfterHeader = response.headers.get("Retry-After");
  const parsedRetryAfter = retryAfterHeader
    ? Number.parseInt(retryAfterHeader, 10)
    : Number.NaN;
  const retryAfter = Number.isNaN(parsedRetryAfter)
    ? undefined
    : parsedRetryAfter;
  return new EyeduxAPIError(
    response.status,
    code,
    message,
    retryAfter,
  );
}