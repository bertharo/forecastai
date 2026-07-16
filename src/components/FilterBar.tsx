"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TreePicker } from "@/components/TreePicker";

type TypeOpt = { id: string; key: string; displayName: string };
type NodeOpt = {
  id: string;
  key: string;
  displayName: string;
  dimensionTypeId: string;
  parentId?: string | null;
  path?: string;
  costCenterCode?: string | null;
};
type ProviderOpt = { key: string; name: string };
type ModelOpt = { skuId: string; name: string };
type FeatureOpt = { key: string };

export function FilterBar({
  types,
  nodes,
  providers = [],
  models = [],
  features = [],
  showMetric = true,
}: {
  types: TypeOpt[];
  nodes: NodeOpt[];
  providers?: ProviderOpt[];
  models?: ModelOpt[];
  features?: FeatureOpt[];
  showMetric?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const typeKey = params.get("dim") ?? "";
  const nodeId = params.get("node") ?? "";
  const provider = params.get("provider") ?? "";
  const model = params.get("model") ?? "";
  const feature = params.get("feature") ?? "";
  const metric = params.get("metric") ?? "spend";

  const selectedType = types.find((t) => t.key === typeKey);
  const filteredNodes = selectedType
    ? nodes
        .filter((n) => n.dimensionTypeId === selectedType.id)
        .map((n) => ({
          id: n.id,
          key: n.key,
          displayName: n.displayName,
          dimensionTypeId: n.dimensionTypeId,
          parentId: n.parentId ?? null,
          path: n.path ?? `/${n.key}`,
          costCenterCode: n.costCenterCode ?? null,
        }))
    : [];

  function set(key: string, value: string, clear: string[] = []) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    for (const c of clear) sp.delete(c);
    router.push(`?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showMetric && (
        <>
          <span className="muted text-[11px] uppercase tracking-wide">Metric</span>
          <select
            className="select"
            value={metric}
            onChange={(e) => set("metric", e.target.value)}
          >
            <option value="spend">Spend</option>
            <option value="consumption">Consumption</option>
            <option value="adoption">Adoption</option>
          </select>
        </>
      )}

      <span className="muted text-[11px] uppercase tracking-wide">Org slice</span>
      <select
        className="select"
        value={typeKey}
        onChange={(e) => set("dim", e.target.value, ["node"])}
      >
        <option value="">All org</option>
        {types.map((t) => (
          <option key={t.id} value={t.key}>
            {t.displayName}
          </option>
        ))}
      </select>
      {selectedType && (
        <TreePicker
          nodes={filteredNodes}
          value={nodeId}
          onChange={(id) => set("node", id)}
          placeholder={`All ${selectedType.displayName}`}
        />
      )}

      {providers.length > 0 && (
        <select
          className="select"
          value={provider}
          onChange={(e) => set("provider", e.target.value)}
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {models.length > 0 && (
        <select
          className="select"
          value={model}
          onChange={(e) => set("model", e.target.value)}
        >
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m.skuId} value={m.skuId}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      {features.length > 0 && (
        <select
          className="select"
          value={feature}
          onChange={(e) => set("feature", e.target.value)}
        >
          <option value="">All features</option>
          {features.map((f) => (
            <option key={f.key} value={f.key}>
              {f.key}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
