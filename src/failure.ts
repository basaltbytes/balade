import { Predicate } from "effect";

/** A safe, compact description for a typed failure or an external exception. */
export function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message;
  if (Predicate.isObject(cause) && "_tag" in cause) {
    const tag = String(cause._tag);
    return "path" in cause ? `${tag}: ${String(cause.path)}` : tag;
  }
  return String(cause);
}
