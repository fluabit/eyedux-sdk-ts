export const APIErrorCode = {
  InvalidAPIKey: "invalid_api_key",
  EventTypeRequired: "event_type_required",
  EventPropertiesEmpty: "event_properties_empty",
  EventExternalObjectConflict: "event_external_object_conflict",
  EventExternalIDNotFound: "event_external_id_not_found",
  EventExternalIDRequired: "event_external_id_required",
  RateLimitExceeded: "RATE_LIMIT_EXCEEDED",
  InternalServerError: "INTERNAL_SERVER_ERROR",
} as const;

export type APIErrorCode = (typeof APIErrorCode)[keyof typeof APIErrorCode];

export type ValidationErrorCode =
  | "EMPTY_API_KEY"
  | "EMPTY_PROJECT_ID"
  | "EMPTY_EXTERNAL_ID";

export class EyeduxValidationError extends Error {
  override readonly name = "EyeduxValidationError";

  constructor(
    public readonly code: ValidationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class EyeduxAPIError extends Error {
  override readonly name = "EyeduxAPIError";

  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly apiMessage: string,
    public readonly retryAfter?: number,
  ) {
    super(`eyedux: ${code} (status ${statusCode})`);
  }
}

export class EyeduxRequestError extends Error {
  override readonly name = "EyeduxRequestError";

  constructor(message: string, options?: ErrorOptions) {
    super(`eyedux: ${message}`, options);
  }
}

export function isNotFound(error: unknown): error is EyeduxAPIError {
  return error instanceof EyeduxAPIError && error.statusCode === 404;
}

export function isConflict(error: unknown): error is EyeduxAPIError {
  return error instanceof EyeduxAPIError && error.statusCode === 409;
}

export function isExternalObjectConflict(
  error: unknown,
): error is EyeduxAPIError {
  return (
    error instanceof EyeduxAPIError &&
    error.code === APIErrorCode.EventExternalObjectConflict
  );
}

export function isRateLimited(error: unknown): error is EyeduxAPIError {
  return error instanceof EyeduxAPIError && error.statusCode === 429;
}

export function isAuthError(error: unknown): error is EyeduxAPIError {
  return (
    error instanceof EyeduxAPIError && error.code === APIErrorCode.InvalidAPIKey
  );
}