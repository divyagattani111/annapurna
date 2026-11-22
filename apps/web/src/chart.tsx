import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  AriaComponent,
  CanvasRenderer,
]);
export default function Chart({
  people,
}: {
  people: Record<string, unknown>[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current);
    const data = people.filter((p) => !String(p.balance).startsWith("-"));
    c.setOption({
      aria: { enabled: true },
      grid: { left: 80, right: 30, top: 20, bottom: 60 },
      xAxis: { type: "category", data: data.map((p) => p.code) },
      yAxis: { type: "value", name: "INR" },
      series: [
        {
          type: "bar",
          data: data.map((p) => p.balance),
          itemStyle: { color: "#2c6b52", borderRadius: [4, 4, 0, 0] },
        },
      ],
    });
    const observer = new ResizeObserver(() => c.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      c.dispose();
    };
  }, [people]);
  return (
    <>
      <h3>Salesman dues · as of today</h3>
      <p className="small muted">
        Server-calculated balances. The Salesmen table provides exact figures.
      </p>
      <div
        role="img"
        aria-label="Salesman dues chart, exact values in Salesmen table"
        ref={ref}
        style={{ height: 260, width: "100%" }}
      />
    </>
  );
}
