/** A safe, compact description for a typed failure or an external exception. */
export function describeFailure(value: unknown): string {
  if (value instanceof Error && value.message.trim() !== "") return value.message;
  if (typeof value === "object" && value !== null && "_tag" in value) {
    const tag = String(value._tag);
    return "path" in value ? `${tag}: ${String(value.path)}` : tag;
  }
  return String(value);
}
