import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";

type MoodPoint = {
  day: string;
  valence: number;
  entries: number;
  entryId: string;
  snippet: string;
  label: string;
};

const MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const fmtDay = (d: string) => {
  const [, mo, da] = d.split("-");
  return `${MONTHS[Number(mo)] ?? ""} ${Number(da)}`;
};

/**
 * The emotional-weather trend — the user's own mood traced over time, the rare Knole surface that's
 * visual + screenshot-worthy. Tapping the chart opens the day behind a point. No advice, just the
 * shape of how they've been — a mirror, not an assistant.
 */
export function MoodWeather({ data }: { data: { points: MoodPoint[]; count: number } }) {
  const [sel, setSel] = useState<MoodPoint | null>(null);
  const points = data.points;

  if (points.length < 3) {
    return (
      <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-7">
        <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-tan">
          Your emotional weather
        </div>
        <p className="font-display text-[18px] italic leading-snug text-muted-foreground">
          This fills in once Knole has read a few more days — your own mood, traced over time.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-tan">
        Your emotional weather
      </div>
      <div className="rounded-2xl border border-rule bg-card/50 p-5">
        <div className="h-[140px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 6, right: 6, bottom: 0, left: 6 }}
              onClick={(state: unknown) => {
                const s = state as { activePayload?: { payload?: MoodPoint }[] };
                const p = s?.activePayload?.[0]?.payload;
                if (p) setSel(p);
              }}
            >
              <defs>
                <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c6545" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#7c6545" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                tickFormatter={fmtDay}
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis domain={[-1, 1]} hide />
              <ReferenceLine y={0} stroke="#e7e5e4" strokeDasharray="3 3" />
              <Tooltip
                cursor={{ stroke: "#7c6545", strokeOpacity: 0.3 }}
                content={(props: unknown) => {
                  const { active, payload } = props as {
                    active?: boolean;
                    payload?: { payload: MoodPoint }[];
                  };
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="rounded-lg border border-rule bg-paper px-3 py-2 text-[11px] shadow-[0_12px_30px_-18px_rgba(28,25,23,0.4)]">
                      <div className="text-muted-foreground">{fmtDay(p.day)}</div>
                      {p.label && <div className="font-display italic text-tan">{p.label}</div>}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="valence"
                stroke="#7c6545"
                strokeWidth={2}
                fill="url(#moodFill)"
                dot={{ r: 2.5, fill: "#7c6545", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#7c6545" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Tap the chart to read the day behind a point
        </p>
      </div>

      {sel && (
        <div className="animate-fade-up mt-3 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {fmtDay(sel.day)}
            </span>
            <div className="flex items-center gap-3">
              {sel.label && <span className="font-display italic text-tan">{sel.label}</span>}
              <button
                onClick={() => setSel(null)}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                close
              </button>
            </div>
          </div>
          <p className="font-display text-[18px] italic leading-snug text-ink-soft">
            &ldquo;{sel.snippet}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
