export const EventEyeduxType = {
  SystemError: "system-error",
  SystemWarning: "system-warning",
  SystemLog: "system-log",
  SystemDebug: "system-debug",
  SystemInfo: "system-info",
  SystemMetric: "system-metric",
} as const;

export type EventEyeduxType =
  (typeof EventEyeduxType)[keyof typeof EventEyeduxType];

export type JsonObject = Record<string, unknown>;

export interface EventObject {
  id: string;
  property: string;
  source?: string;
}

export interface EyeduxEvent {
  id: string;
  environment: string;
  eyeduxType: EventEyeduxType | null;
  type: string;
  typeGroup: string;
  properties: JsonObject;
  status: "active" | "deleted";
  timestamp: string;
  createdAt: string;
  externalObject: EventObject | null;
  correlationObject: EventObject | null;
  metadata: JsonObject | null;
}

export interface CreateEventInput {
  projectId?: string;
  type: string;
  typeGroup?: string;
  eyeduxType?: EventEyeduxType;
  properties: JsonObject;
  externalObject?: EventObject;
  correlationObject?: EventObject;
  metadata?: JsonObject;
}

export interface ListEventsInput {
  type?: string;
  correlationId?: string;
}

export interface EmitInput extends CreateEventInput {
  error?: unknown;
  operation?: string;
  sourceSkip?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface EyeduxClientOptions {
  projectId?: string;
  timeoutMs?: number;
  defaultMetadata?: JsonObject;
  fetch?: typeof globalThis.fetch;
}

export interface EyeduxClientConfig extends EyeduxClientOptions {
  apiKey: string;
  projectId: string;
}