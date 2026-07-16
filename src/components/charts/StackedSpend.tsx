"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";
import { ClientOnly } from "@/components/ClientOnly";

const COLORS = ["#3d9a7a", "#5b8def", "#d4a017", "#c45c5c", "#8b93a7", "#a78bfa"];

export function StackedSpend({
  data,
  keys,
}: {
  data: Record<string, string | number>[];
  keys: string[];
}) {
  return (
    <ClientOnly fallback={<div className="flex h-64 items-center muted">Loading chart…</div>}>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1e2430" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fill: "#8b93a7", fontSize: 11 }} minTickGap={40} />
            <YAxis
              tick={{ fill: "#8b93a7", fontSize: 11 }}
              tickFormatter={(v) => usd(v, { compact: true })}
            />
            <Tooltip
              contentStyle={{
                background: "#12151a",
                border: "1px solid #1e2430",
                fontSize: 12,
              }}
              formatter={(value) => usd(Number(value ?? 0), { digits: 0 })}
            />
            <Legend />
            {keys.map((k, i) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                stackId="1"
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.55}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ClientOnly>
  );
}
