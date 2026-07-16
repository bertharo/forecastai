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

export function FanChartInner({
  data,
  budget,
}: {
  data: { day: string; p10: number; p50: number; p90: number }[];
  budget?: number;
}) {
  const chartData = data.map((d) => ({
    day: String(d.day),
    p10: Number(d.p10),
    p50: Number(d.p50),
    p90: Number(d.p90),
    band: Number(d.p90) - Number(d.p10),
    budget: budget != null ? Number(budget) : undefined,
  }));

  return (
    <div className="h-72 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1e2430" strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fill: "#8b93a7", fontSize: 11 }} minTickGap={40} />
          <YAxis
            tick={{ fill: "#8b93a7", fontSize: 11 }}
            tickFormatter={(v) => usd(Number(v), { compact: true })}
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
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band"
            stackId="band"
            stroke="none"
            fill="#3d9a7a"
            fillOpacity={0.18}
            name="P10–P90"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            stroke="#3d9a7a"
            strokeWidth={2}
            dot={false}
            name="P50"
            isAnimationActive={false}
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
              isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
