export function getOrCreateClientViewerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cv-${Math.random().toString(36).slice(2, 10)}`;
}
