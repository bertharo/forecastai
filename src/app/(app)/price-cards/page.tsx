import { DataTable } from "@/components/DataTable";
import { Money } from "@/components/Money";
import { assertDb, db } from "@/db";
import * as s from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function PriceCardsPage() {
  await assertDb();
  const cards = await db.select().from(s.priceCards).orderBy(asc(s.priceCards.effectiveFrom));
  const lines = await db
    .select({
      id: s.priceCardLines.id,
      priceCardId: s.priceCardLines.priceCardId,
      unitPrice: s.priceCardLines.unitPrice,
      sku: s.skus.skuId,
      meter: s.meters.meterKey,
      provider: s.providers.displayName,
    })
    .from(s.priceCardLines)
    .innerJoin(s.meters, eq(s.priceCardLines.meterId, s.meters.id))
    .leftJoin(s.skus, eq(s.priceCardLines.skuId, s.skus.id))
    .innerJoin(s.priceCards, eq(s.priceCardLines.priceCardId, s.priceCards.id))
    .innerJoin(s.providers, eq(s.priceCards.providerId, s.providers.id));

  const anthCards = cards.filter((c) => c.name.toLowerCase().includes("anthropic"));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Price Cards</h1>
        <p className="muted mt-1">
          Versioned pricing with effective dates — historical cost time-travels to the card in effect
        </p>
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Cards</h2>
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "source", label: "Source" },
            { key: "from", label: "Effective from" },
            { key: "to", label: "Effective to" },
            { key: "ver", label: "Ver", align: "right" },
          ]}
          rows={cards.map((c) => ({
            name: c.name,
            source: c.source,
            from: c.effectiveFrom.toISOString().slice(0, 10),
            to: c.effectiveTo ? c.effectiveTo.toISOString().slice(0, 10) : "open",
            ver: c.version,
          }))}
        />
      </div>

      {anthCards.length >= 2 && (
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Anthropic price cut — diff</h2>
          <p className="muted mb-3 text-[12px]">
            Seed includes a mid-history Sonnet price change. Past events keep pre-cut rates.
          </p>
          <DataTable
            columns={[
              { key: "sku", label: "SKU" },
              { key: "meter", label: "Meter" },
              { key: "before", label: "Before ($/MTok)", align: "right" },
              { key: "after", label: "After ($/MTok)", align: "right" },
              { key: "delta", label: "Δ", align: "right" },
            ]}
            rows={(() => {
              const v1 = anthCards[0];
              const v2 = anthCards[1];
              const before = lines.filter((l) => l.priceCardId === v1.id);
              const after = lines.filter((l) => l.priceCardId === v2.id);
              return before
                .filter((b) => b.sku?.includes("sonnet"))
                .map((b) => {
                  const a = after.find((x) => x.sku === b.sku && x.meter === b.meter);
                  const bPrice = Number(b.unitPrice) * 1e6;
                  const aPrice = a ? Number(a.unitPrice) * 1e6 : bPrice;
                  return {
                    sku: b.sku,
                    meter: b.meter,
                    before: bPrice.toFixed(2),
                    after: aPrice.toFixed(2),
                    delta: (
                      <span style={{ color: aPrice < bPrice ? "var(--accent)" : "var(--danger)" }}>
                        {(aPrice - bPrice).toFixed(2)}
                      </span>
                    ),
                  };
                });
            })()}
          />
        </div>
      )}

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">All lines</h2>
        <DataTable
          columns={[
            { key: "provider", label: "Provider" },
            { key: "sku", label: "SKU" },
            { key: "meter", label: "Meter" },
            { key: "price", label: "Unit price", align: "right" },
          ]}
          rows={lines.slice(0, 40).map((l) => ({
            provider: l.provider,
            sku: l.sku ?? "—",
            meter: l.meter,
            price:
              l.meter === "seats" || l.meter === "premium_requests" ? (
                <Money value={Number(l.unitPrice)} digits={2} />
              ) : (
                <span className="mono">${(Number(l.unitPrice) * 1e6).toFixed(2)}/MTok</span>
              ),
          }))}
        />
      </div>
    </div>
  );
}
