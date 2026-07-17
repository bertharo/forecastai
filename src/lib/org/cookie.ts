export const ORG_COOKIE = "meter_org";
/** JSON array of { id, token } for workspaces this browser owns. */
export const WS_REGISTRY_COOKIE = "meter_ws";
export const ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type WorkspaceEntry = { id: string; token: string };

export function parseWorkspaceRegistry(raw: string | undefined): WorkspaceEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is WorkspaceEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as WorkspaceEntry).id === "string" &&
          typeof (e as WorkspaceEntry).token === "string"
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function serializeWorkspaceRegistry(entries: WorkspaceEntry[]): string {
  // Dedupe by id, keep latest token
  const map = new Map<string, string>();
  for (const e of entries) map.set(e.id, e.token);
  return JSON.stringify(
    [...map.entries()].map(([id, token]) => ({ id, token }))
  );
}

export function upsertWorkspaceEntry(
  entries: WorkspaceEntry[],
  entry: WorkspaceEntry
): WorkspaceEntry[] {
  return parseWorkspaceRegistry(
    serializeWorkspaceRegistry([...entries.filter((e) => e.id !== entry.id), entry])
  );
}
