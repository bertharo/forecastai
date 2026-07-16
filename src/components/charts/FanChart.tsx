"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usd } from "@/lib/format";
import { ClientOnly } from "@/components/ClientOnly";

export function FanChart({
  data,
  budget,
}: {
  data: { day: string; p10: number; p50: number; p90: number }[];
  budget?: number;
}) {
  const chartData = data.map((d) => ({
    ...d,
    band: d.p90 - d.p10,
    budget: budget ?? undefined,
  }));

  return (
    <ClientOnly fallback={<div className="flex h-72 items-center muted">Loading chart…</div>}>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
            <Area
              type="monotone"
              dataKey="p10"
              stackId="band"
              stroke="none"
              fill="transparent"
              name="P10"
            />
            <Area
              type="monotone"
              dataKey="band"
              stackId="band"
              stroke="none"
              fill="#3d9a7a"
              fillOpacity={0.18}
              name="P10–P90"
            />
            <Line
              type="monotone"
              dataKey="p50"
              stroke="#3d9a7a"
              strokeWidth={2}
              dot={false}
              name="P50"
            />
            {budget != null && (
              <Line
                type="monotone"
                dataKey="budget"
                stroke="#d4a017"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                dot={false}
                name="Budget / day"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ClientOnly>
  );
}
