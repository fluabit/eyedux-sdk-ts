import type { JsonObject } from "./types.js";

export interface ErrorSource {
  file: string;
  function: string;
  line: number;
}

const SDK_FRAME_PATTERN = /(?:currentErrorSource|errorProperties(?:WithSourceSkip)?|EyeduxClient\.emitError)/;

export function currentErrorSource(sourceSkip = 0): ErrorSource | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;

  const applicationFrames = stack
    .split("\n")
    .slice(1)
    .filter((line) => !SDK_FRAME_PATTERN.test(line));
  const frame = applicationFrames[Math.max(0, sourceSkip)];
  if (!frame) return undefined;

  const match = frame.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (!match) return undefined;

  const filePath = match[2] ?? "";
  return {
    file: filePath.split(/[\\/]/).pop() ?? filePath,
    function: match[1] ?? "<anonymous>",
    line: Number(match[3]),
  };
}

export function errorProperties(
  properties: JsonObject,
  error?: unknown,
  operation?: string,
): JsonObject {
  return errorPropertiesWithSourceSkip(properties, error, operation, 0);
}

export function errorPropertiesWithSourceSkip(
  properties: JsonObject,
  error?: unknown,
  operation?: string,
  sourceSkip = 0,
): JsonObject {
  const enriched: JsonObject = { ...properties };
  if (error !== undefined) {
    enriched.error = error instanceof Error ? error.message : String(error);
  }
  if (operation) enriched.operation = operation;

  const source = currentErrorSource(sourceSkip);
  if (source) {
    enriched.source_file = source.file;
    enriched.source_line = source.line;
    enriched.source_function = source.function;
  }
  return enriched;
}