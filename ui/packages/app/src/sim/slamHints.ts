import type { Hint } from "./HoverHint";
import { fmt, fmtMeters } from "./HoverHint";

const ACCENT = "var(--accent-primary)";
const NOMINAL = "var(--status-nominal)";
const FLAG = "var(--status-flagged)";
const MUTE = "var(--text-low)";

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function truthPoseHint(id: string | number, x: number, y: number): Hint {
  return {
    title: `TRUTH POSE · p${id}`,
    blurb:
      "Ground-truth pose used for pedagogy only. The optimizer never sees this — its job is to recover the trajectory from noisy odometry and landmark observations alone.",
    accent: MUTE,
    rows: [
      { label: "Index", value: String(id) },
      { label: "Position", value: `(${fmt(x, 2)}, ${fmt(y, 2)})`, tone: "mute" },
    ],
  };
}

export function estimatedPoseHint(
  id: string | number,
  estX: number,
  estY: number,
  truth?: { x: number; y: number },
  isAnchor = false,
): Hint {
  const err = truth ? dist(estX, estY, truth.x, truth.y) : null;
  return {
    title: isAnchor ? `ANCHOR POSE · p${id}` : `ESTIMATED POSE · p${id}`,
    blurb: isAnchor
      ? "First pose, pinned to the origin to fix the SLAM gauge freedom (translation + rotation). Without an anchor, the whole graph would float."
      : "An optimizer-recovered pose. The least-squares solver shifts it so that odometry + landmark + closure factors minimise residual error (χ²) in tangent space.",
    accent: isAnchor ? ACCENT : NOMINAL,
    rows: [
      { label: "Position", value: `(${fmt(estX, 2)}, ${fmt(estY, 2)})` },
      ...(truth ? [{ label: "Truth", value: `(${fmt(truth.x, 2)}, ${fmt(truth.y, 2)})`, tone: "mute" as const }] : []),
      ...(err !== null
        ? [{ label: "Error", value: fmtMeters(err), tone: err > 0.5 ? ("warn" as const) : ("accent" as const) }]
        : []),
    ],
  };
}

export function truthLandmarkHint(id: string | number, x: number, y: number): Hint {
  return {
    title: `TRUTH LANDMARK · L${id}`,
    blurb:
      "Ground-truth landmark position (lesson-only). Estimated landmarks are joined to truth via the orange error connector — the gap shrinks as the optimizer converges.",
    accent: MUTE,
    rows: [
      { label: "Position", value: `(${fmt(x, 2)}, ${fmt(y, 2)})`, tone: "mute" },
    ],
  };
}

export function estimatedLandmarkHint(
  id: string | number,
  estX: number,
  estY: number,
  truth?: [number, number],
): Hint {
  const err = truth ? dist(estX, estY, truth[0], truth[1]) : null;
  return {
    title: `ESTIMATED LANDMARK · L${id}`,
    blurb:
      "Landmark position recovered by joint factor-graph optimisation. Every observation factor pulls this point toward the agent's measured bearing+range — averaging across observers gives the consensus position.",
    accent: NOMINAL,
    rows: [
      { label: "Position", value: `(${fmt(estX, 2)}, ${fmt(estY, 2)})` },
      ...(truth
        ? [
            { label: "Truth", value: `(${fmt(truth[0], 2)}, ${fmt(truth[1], 2)})`, tone: "mute" as const },
            { label: "Error", value: fmtMeters(err ?? 0), tone: (err ?? 0) > 0.3 ? ("warn" as const) : ("accent" as const) },
          ]
        : []),
    ],
  };
}

export function landmarkErrorEdgeHint(error: number): Hint {
  return {
    title: "LANDMARK ERROR",
    blurb:
      "Visualises the residual between an estimated landmark and its ground-truth position. A long orange segment means the optimizer hasn't recovered this landmark yet — usually because not enough observations have constrained it.",
    accent: FLAG,
    rows: [
      { label: "Error", value: fmtMeters(error), tone: error > 0.5 ? "danger" : "warn" },
    ],
  };
}

export function loopClosureHint(fromId: string | number, toId: string | number, drift?: number): Hint {
  return {
    title: `LOOP CLOSURE · p${fromId} ↔ p${toId}`,
    blurb:
      "A constraint added when the agent re-observes a landmark from a previously visited pose. This single edge collapses accumulated odometry drift across the entire loop — the optimiser redistributes the correction back through every pose between the two endpoints (ADR 0017).",
    accent: ACCENT,
    rows: [
      { label: "From", value: `p${fromId}` },
      { label: "To", value: `p${toId}` },
      ...(drift !== undefined
        ? [{ label: "Drift before", value: fmtMeters(drift), tone: "warn" as const }]
        : []),
    ],
  };
}

export function odometryEdgeHint(): Hint {
  return {
    title: "ODOMETRY FACTOR",
    blurb:
      "Per-step motion constraint between consecutive poses, derived from the agent's own wheel/IMU integration. It's the dead-reckoning prior: cheap but drifts without external correction.",
    accent: MUTE,
    rows: [],
  };
}

export function interRobotEdgeHint(
  fromId: string,
  toId: string,
  distance?: number,
  weight?: number,
): Hint {
  const w = weight ?? 1.0;
  const suppressed = w < 0.5;
  const blurb = suppressed
    ? "DCS has shrunk this factor's weight (source-reputation × GNC). The optimizer is effectively ignoring it — that's why the joint map recovers from the lie."
    : "Co-observation edge between two agents that saw the same landmark or ranged each other. With DCS on, the factor's weight is its source's reputation — a low-rep source contributes less.";
  return {
    title: `INTER-ROBOT FACTOR · ${fromId} ↔ ${toId}`,
    blurb,
    accent: suppressed ? "var(--status-byzantine)" : ACCENT,
    rows: [
      { label: "From", value: fromId },
      { label: "To", value: toId },
      ...(distance !== undefined
        ? [{ label: "Distance", value: fmtMeters(distance) }]
        : []),
      ...(weight !== undefined
        ? [
            {
              label: "DCS weight",
              value: weight.toFixed(3),
              tone: suppressed ? ("danger" as const) : ("accent" as const),
            },
          ]
        : []),
    ],
  };
}

export function estimatedAgentHint(
  agentId: string,
  estX: number,
  estY: number,
  truth?: [number, number],
  reputation?: number,
): Hint {
  const err = truth ? dist(estX, estY, truth[0], truth[1]) : null;
  const isA0 = agentId === "A0";
  const blurb = isA0
    ? "A0 is the lying peer in pose_lie scenarios — it broadcasts a falsified self-pose. With bidirectional rep gating ON, the SLAM solver weighs its factors by reputation; OFF, it drags the joint map ~1.4 m off truth."
    : "Honest agent — its odometry, landmark observations, and inter-robot range factors all enter the joint solve at full weight.";
  return {
    title: `AGENT · ${agentId}`,
    blurb,
    accent: isA0 ? FLAG : NOMINAL,
    rows: [
      { label: "Estimate", value: `(${fmt(estX, 2)}, ${fmt(estY, 2)})` },
      ...(truth
        ? [
            { label: "Truth", value: `(${fmt(truth[0], 2)}, ${fmt(truth[1], 2)})`, tone: "mute" as const },
            { label: "Pose error", value: fmtMeters(err ?? 0), tone: (err ?? 0) > 0.5 ? ("warn" as const) : ("accent" as const) },
          ]
        : []),
      ...(reputation !== undefined
        ? [{ label: "Reputation", value: fmt(reputation, 3), tone: reputation < 0.5 ? ("warn" as const) : ("accent" as const) }]
        : []),
    ],
  };
}

export function reputationTraceHint(agentId: string): Hint {
  return {
    title: `REPUTATION TRACE · ${agentId}`,
    blurb:
      "Reputation evolution across 5 closed-loop cycles. In bidirectional mode, SLAM χ² residuals feed back into the trust layer — a peer that consistently produces large residuals (A0) sees its reputation collapse, which then down-weights its factors next cycle.",
    accent: ACCENT,
    rows: [{ label: "Agent", value: agentId }],
  };
}

export function truthTrajectoryHint(): Hint {
  return {
    title: "GROUND TRUTH TRAJECTORY",
    blurb:
      "The path the agent really took. Drawn for pedagogy only — the optimiser only has noisy odometry + landmark observations and must recover this curve from constraints.",
    accent: MUTE,
    rows: [],
  };
}

export function estimatedTrajectoryHint(): Hint {
  return {
    title: "ESTIMATED TRAJECTORY",
    blurb:
      "Optimised pose chain. Compare its shape to the dashed truth path: pre-LM there's pure odometry drift; post-LM landmarks pull it back; post-closure the loop snaps shut.",
    accent: NOMINAL,
    rows: [],
  };
}
