import type { TickSnapshot } from "@specter/sim-core";
import { useMemo } from "react";
import { Cluster, Mono, Stack, StatusDot } from "../lib";
import { Sparkline } from "../charts";
import { useSimStore } from "./simStore";

type Status = "nominal" | "flagged" | "byzantine";

function statusOf(rep: number): Status {
  if (rep < 0.4) return "byzantine";
  if (rep < 0.55) return "flagged";
  return "nominal";
}

function colorFor(status: Status): string {
  if (status === "byzantine") return "var(--status-byzantine)";
  if (status === "flagged") return "var(--status-flagged)";
  return "var(--status-nominal)";
}

const SPARK_W_VERTICAL = 240;
const SPARK_W_HORIZONTAL = 96;
const SPARK_H = 18;

type Props = {
  snapshot: TickSnapshot | null;
  layout?: "vertical" | "horizontal";
};

export function AgentRepList({ snapshot, layout = "vertical" }: Props) {
  const result = useSimStore((s) => s.result);
  const tickIndex = useSimStore((s) => s.tickIndex);
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);

  const seriesById = useMemo(() => {
    const out: Record<string, number[]> = {};
    if (!result) return out;
    const lastSnap = result.snapshots[result.snapshots.length - 1];
    if (!lastSnap) return out;
    for (const a of lastSnap.agents) {
      if (a.phantom) continue;
      out[a.id] = [];
    }
    for (const snap of result.snapshots) {
      for (const id of Object.keys(out)) {
        out[id]!.push(snap.consensusReputations[id] ?? snap.reputations[id] ?? 0.5);
      }
    }
    return out;
  }, [result]);

  if (!snapshot || !result) return null;
  const ids = Object.keys(seriesById);
  const detectionIndex = attackStartTick > 0 ? attackStartTick - 1 : undefined;
  const sparkWidth = layout === "horizontal" ? SPARK_W_HORIZONTAL : SPARK_W_VERTICAL;

  const cards = ids.map((id) => {
    const series = seriesById[id] ?? [];
    const currentRep =
      snapshot.consensusReputations[id] ?? snapshot.reputations[id] ?? 0.5;
    const status = statusOf(currentRep);
    const color = colorFor(status);

    let minRep = Infinity;
    let minIdx = 0;
    for (let i = 0; i < series.length; i++) {
      if (series[i]! < minRep) {
        minRep = series[i]!;
        minIdx = i;
      }
    }
    if (!isFinite(minRep)) minRep = currentRep;

    if (layout === "horizontal") {
      return (
        <Stack key={id} gap={1} style={{ flex: "1 1 0", minWidth: 96 }}>
          <Cluster gap={2} align="center" style={{ justifyContent: "space-between" }}>
            <Cluster gap={1} align="center">
              <StatusDot status={status} />
              <Mono size="sm" style={{ color: "var(--text-hi)" }}>
                {id}
              </Mono>
            </Cluster>
            <Mono size="sm" style={{ color, fontSize: 13, fontWeight: 600 }}>
              {currentRep.toFixed(2)}
            </Mono>
          </Cluster>
          <Sparkline
            data={series}
            width={sparkWidth}
            height={SPARK_H}
            yMin={0}
            yMax={1}
            threshold={0.4}
            cursorIndex={tickIndex}
            detectionIndex={detectionIndex}
            finalColor={color}
            barColor="var(--border-strong)"
          />
          <Mono size="sm" muted style={{ fontSize: 11, color: "var(--text-low)" }}>
            min {minRep.toFixed(2)} @ t{minIdx + 1}
          </Mono>
        </Stack>
      );
    }

    return (
      <Stack key={id} gap={1}>
        <Cluster gap={3} align="center" style={{ justifyContent: "space-between" }}>
          <Cluster gap={2} align="center">
            <StatusDot status={status} />
            <Mono size="sm" style={{ width: 28, color: "var(--text-hi)" }}>
              {id}
            </Mono>
          </Cluster>
          <Cluster gap={3} align="baseline">
            <Mono size="sm" muted style={{ fontSize: 11.5, color: "var(--text-low)" }}>
              min {minRep.toFixed(2)} @ t{minIdx + 1}
            </Mono>
            <Mono size="md" style={{ color, width: 44, textAlign: "right" }}>
              {currentRep.toFixed(2)}
            </Mono>
          </Cluster>
        </Cluster>
        <Sparkline
          data={series}
          width={sparkWidth}
          height={SPARK_H}
          yMin={0}
          yMax={1}
          threshold={0.4}
          cursorIndex={tickIndex}
          detectionIndex={detectionIndex}
          finalColor={color}
          barColor="var(--border-strong)"
        />
      </Stack>
    );
  });

  if (layout === "horizontal") {
    return (
      <Cluster gap={3} align="start" style={{ width: "100%" }}>
        {cards}
      </Cluster>
    );
  }
  return <Stack gap={1}>{cards}</Stack>;
}
