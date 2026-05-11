/**
 * Structured JSON logger for server code. Emits one JSON object per line so
 * Docker's stdout/stderr stream is greppable today and trivially ingestible
 * by a log drain (Loki, Datadog, BetterStack) the moment one is wired.
 *
 * Why not console.error?
 *   - "[cron/foo] failed for X: Error: bar" buries fields inside a string.
 *     With structured logs, every entry has consistent keys (scope, orgId,
 *     krId, error.name, error.stack) so filtering by org or KR is grep-able.
 *   - The 24 console.error sites already invented their own ad-hoc tag
 *     conventions ("[gleap]", "[cron/check-alerts]") — encoding the tag as
 *     a `scope` field instead lets us query without parsing strings.
 *
 * The logger itself must never throw — a failure to log is acceptable; a
 * failure that takes down the request handler that called it is not.
 */

export type LogFields = Record<string, unknown>;

export type Logger = {
  /** Bind a fixed `scope` (and optional extra fields) to all log lines. */
  child(scope: string, extra?: LogFields): Logger;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields, error?: unknown): void;
};

interface ErrorPayload {
  name: string;
  message: string;
  stack?: string;
}

function serializeError(err: unknown): ErrorPayload | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "NonError", message: String(err) };
}

type Level = "info" | "warn" | "error";

function emit(level: Level, payload: Record<string, unknown>) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      ...payload,
    });
    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  } catch {
    // JSON.stringify can throw on circular refs — fall back to a minimal
    // record so we at least know something tried to log.
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "[log] failed to serialize log payload",
      }) + "\n"
    );
  }
}

function makeLogger(bound: LogFields = {}): Logger {
  return {
    child(scope, extra) {
      return makeLogger({ ...bound, scope, ...(extra ?? {}) });
    },
    info(message, fields) {
      emit("info", { msg: message, ...bound, ...(fields ?? {}) });
    },
    warn(message, fields) {
      emit("warn", { msg: message, ...bound, ...(fields ?? {}) });
    },
    error(message, fields, error) {
      const errorPayload = serializeError(error);
      emit("error", {
        msg: message,
        ...bound,
        ...(fields ?? {}),
        ...(errorPayload ? { error: errorPayload } : {}),
      });
    },
  };
}

/**
 * Root logger. Most call sites should use `.child("scope-name")` so every
 * line carries a consistent scope tag.
 */
export const log: Logger = makeLogger();
