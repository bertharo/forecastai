/** Human "3h ago" / "just now" for connector sync timestamps. */
export function formatRelativeAgo(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (Number.isNaN(t)) return "Never";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
