import type { ConnectorAdapter } from "./types";

const adapters = new Map<string, ConnectorAdapter>();

export function registerAdapter(adapter: ConnectorAdapter) {
  adapters.set(adapter.providerKey, adapter);
}

export function getAdapter(providerKey: string): ConnectorAdapter | undefined {
  return adapters.get(providerKey);
}

export function listAdapters(): ConnectorAdapter[] {
  return [...adapters.values()];
}
