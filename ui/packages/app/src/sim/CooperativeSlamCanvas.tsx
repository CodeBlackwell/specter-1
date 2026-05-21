import { useMemo, useRef, useState } from "react";
import { cooperativeSlamTruth, type CooperativeScenario } from "@specter/sim-core";
import { Stack } from "../lib/Stack";
import { Cluster } from "../lib/Cluster";
import { Mono } from "../lib/Mono";
import { useCurrentSnapshot } from "./simStore";
import { type Hint, HoverHintOverlay } from "./HoverHint";
import {
  estimatedAgentHint,
  estimatedLandmarkHint,
  interRobotEdgeHint,
  landmarkErrorEdgeHint,
  truthLandmarkHint,
  truthPoseHint,
} from "./slamHints";
import { SlamSceneBackground, AGENT_R, LM_R, STROKE, HEADING_LEN, LABEL_FONT } from "./slamRender";

function colorForAgent(id: string, scenario: CooperativeScenario): string {
  if (id === "A0" && scenario !== "honest") return "var(--status-byzantine)";
  return "var(--status-nominal)";
}

type Props = { scenario: Exclude<CooperativeScenario, "pose_lie_robust"> };

export function CooperativeSlamCanvas({ scenario }: Props) {
  const snap = useCurrentSnapshot();
  const truth = useMemo(() => cooperativeSlamTruth(), []);
  const [hint, setHint] = useState<Hint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const truthAgents = new Map(truth.agents);
  const truthLm = new Map(truth.landmarks);

  const slam = snap?.slam;
  if (!slam || slam.kind !== "cooperative" || slam.scenario !== scenario) return null;
  const slamAgents = slam.slamAgents ?? [];
  const landmarks = slam.landmarks;
  const interRobotEdges = slam.interRobotEdges ?? [];

  return (
    <Stack gap={2} grow style={{ minHeight: 0 }}>
      <Cluster gap={2} align="center">
        <Mono size="sm" className="t-label" style={{ color: "var(--text-low)", letterSpacing: 1 }}>
          {slam.stageLabel}
        </Mono>
        <Mono size="sm" muted>
          step {slam.cycle + 1}/{slam.totalStages} · cost {slam.cost.toFixed(3)} · LM iter {slam.iterations}
          {scenario === "pose_lie_naive" && slam.cycle > 0 ? " · A0 lying (no rep gating)" : ""}
        </Mono>
      </Cluster>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}
      >
        <SlamSceneBackground>
          {interRobotEdges.map((e, i) => {
            const from = slamAgents.find((a) => a.id === e.fromId)?.pose;
            const to = slamAgents.find((a) => a.id === e.toId)?.pose;
            if (!from || !to) return null;
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            const weight = e.weight ?? 1.0;
            // Lerp stroke + opacity from full at weight=1 to hairline at floor.
            // DCS REPUTATION_FLOOR = 0.01 in poseGraph.ts; map weight∈[0,1] to
            // visual strength via a square-root curve so the regime where the
            // optimizer starts ignoring this edge (weight < 0.5) is visible.
            const visualStrength = Math.sqrt(Math.max(0, Math.min(1, weight)));
            const suppressed = weight < 0.5;
            return (
              <g key={`edge-${i}`}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={suppressed ? "var(--status-byzantine)" : "var(--accent-dim)"}
                  strokeWidth={STROKE * (0.25 + 0.75 * visualStrength)}
                  strokeDasharray="0.15 0.15"
                  opacity={0.25 + 0.55 * visualStrength}
                />
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="transparent"
                  strokeWidth={STROKE * 6}
                  style={{ cursor: "help" }}
                  onPointerEnter={() => setHint(interRobotEdgeHint(e.fromId, e.toId, distance, weight))}
                  onPointerLeave={() => setHint(null)}
                />
              </g>
            );
          })}
          {slamAgents.map((a) => {
            const t = truthAgents.get(a.id);
            if (!t) return null;
            return (
              <circle
                key={`truth-${a.id}`}
                cx={t[0]} cy={t[1]} r={AGENT_R * 0.65}
                fill="none"
                stroke="var(--text-low)"
                strokeWidth={STROKE * 0.6}
                strokeDasharray="0.12 0.12"
                opacity={0.55}
                style={{ cursor: "help" }}
                onPointerEnter={() => setHint(truthPoseHint(`${a.id}-truth`, t[0], t[1]))}
                onPointerLeave={() => setHint(null)}
              />
            );
          })}
          {truth.landmarks.map(([id, [x, y]]) => (
            <rect
              key={`truth-lm-${id}`}
              x={x - LM_R} y={y - LM_R}
              width={LM_R * 2} height={LM_R * 2}
              fill="none"
              stroke="var(--text-low)"
              strokeWidth={STROKE * 0.6}
              opacity={0.45}
              style={{ cursor: "help" }}
              onPointerEnter={() => setHint(truthLandmarkHint(id, x, y))}
              onPointerLeave={() => setHint(null)}
            />
          ))}
          {landmarks.map(([id, [x, y]]) => {
            const t = truthLm.get(id);
            const err = t ? Math.hypot(x - t[0], y - t[1]) : 0;
            return (
              <g key={`est-lm-${id}`}>
                {t ? (
                  <line
                    x1={t[0]} y1={t[1]} x2={x} y2={y}
                    stroke="var(--status-flagged)"
                    strokeWidth={STROKE * 0.7}
                    opacity={0.7}
                    style={{ cursor: "help" }}
                    onPointerEnter={() => setHint(landmarkErrorEdgeHint(err))}
                    onPointerLeave={() => setHint(null)}
                  />
                ) : null}
                <rect
                  x={x - LM_R} y={y - LM_R}
                  width={LM_R * 2} height={LM_R * 2}
                  fill="var(--status-nominal)"
                  opacity={0.85}
                  style={{ cursor: "help" }}
                  onPointerEnter={() => setHint(estimatedLandmarkHint(id, x, y, t))}
                  onPointerLeave={() => setHint(null)}
                />
              </g>
            );
          })}
          {slamAgents.map((a) => {
            const t = truthAgents.get(a.id);
            const color = colorForAgent(a.id, scenario);
            const headingX = a.pose.x + Math.cos(a.pose.theta) * HEADING_LEN;
            const headingY = a.pose.y + Math.sin(a.pose.theta) * HEADING_LEN;
            return (
              <g
                key={`est-${a.id}`}
                style={{ cursor: "help" }}
                onPointerEnter={() => setHint(estimatedAgentHint(a.id, a.pose.x, a.pose.y, t))}
                onPointerLeave={() => setHint(null)}
              >
                <circle
                  cx={a.pose.x}
                  cy={a.pose.y}
                  r={AGENT_R}
                  fill={color}
                  fillOpacity={0.22}
                  stroke={color}
                  strokeWidth={STROKE}
                />
                <line
                  x1={a.pose.x}
                  y1={a.pose.y}
                  x2={headingX}
                  y2={headingY}
                  stroke={color}
                  strokeWidth={STROKE}
                />
              </g>
            );
          })}
          <g transform="scale(1 -1)">
            {slamAgents.map((a) => (
              <text
                key={`label-${a.id}`}
                x={a.pose.x}
                y={-(a.pose.y) - AGENT_R - LABEL_FONT * 0.4}
                fontSize={LABEL_FONT}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
                fill="var(--text-hi)"
              >
                {a.id}
              </text>
            ))}
          </g>
        </SlamSceneBackground>
        <HoverHintOverlay hint={hint} containerRef={containerRef} />
      </div>
      <Mono size="sm" muted>
        Dashed grey rings/squares = truth · solid = estimate · orange = landmark error · grey dashes = inter-robot edges
        {scenario === "pose_lie_naive" ? " · A0 (red) reports landmark positions from a lying self-pose" : ""}
      </Mono>
    </Stack>
  );
}
