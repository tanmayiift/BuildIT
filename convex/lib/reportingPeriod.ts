export function utcMonth(now: number) {
  const date = new Date(now);
  return { since: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), until: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) };
}

export function utcWeek(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay());
}
