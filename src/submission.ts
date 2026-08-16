/** Shape rules shared by model-authored document bodies and fragments. */

export function hasEnvelopeOrFence(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith("---") || trimmed.startsWith("```");
}
