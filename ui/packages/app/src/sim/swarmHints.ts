import type { Agent, Observation } from "@specter/sim-core";
import type { Hint, HintRow } from "./HoverHint";
import { fmt, fmtMeters, fmtPct, fmtRad } from "./HoverHint";
import type { CopEntry, MapAttack } from "./contacts";
import type { RejectionEvent } from "./rejections";
import type { Item } from "./world";
import { AO_WORLD } from "./world";

type Status = "nominal" | "flagged" | "byzantine";

const ACCENT = "var(--accent-primary)";
const STATUS_BYZ = "var(--status-byzantine)";
const STATUS_FLAG = "var(--status-flagged)";
const STATUS_OK = "var(--status-nominal)";
const MUTE = "var(--text-low)";

function statusAccent(status: Status): string {
  if (status === "byzantine") return STATUS_BYZ;
  if (status === "flagged") return STATUS_FLAG;
  return STATUS_OK;
}

export function agentHint(agent: Agent, rep: number, status: Status, byzantineThreshold: number): Hint {
  const phantom = agent.phantom === true;
  if (phantom) {
    return {
      title: `PHANTOM · ${agent.id}`,
      blurb:
        "A non-physical agent injected by an attacker. Real beacons never reach it, so V3 transitive presence collapses any reputation it tries to accumulate.",
      accent: ACCENT,
      rows: [
        { label: "Position", value: `(${fmt(agent.x, 1)}, ${fmt(agent.y, 1)})` },
        { label: "Velocity", value: `${fmtMeters(Math.hypot(agent.vx, agent.vy))}/tick` },
        { label: "Reputation", value: fmt(rep, 3), tone: "danger" },
        { label: "Presence", value: "NONE (Sybil)", tone: "danger" },
      ],
    };
  }
  const speed = Math.hypot(agent.vx, agent.vy);
  const heading = speed > 1e-6 ? Math.atan2(agent.vy, agent.vx) : agent.theta;
  const blurb =
    status === "byzantine"
      ? "Reputation has fallen below the Byzantine cutoff. Tier-1 voting now ignores this peer's range claims and Tier-2 MDS uses it as a witness against colluders."
      : status === "flagged"
        ? "Reputation has dipped from the nominal band. The swarm is provisionally skeptical but still ingests measurements — recovery happens via exponential decay."
        : "Reputation is in the nominal band. Range observations and gossip from this peer are weighted in full.";
  return {
    title: `AGENT · ${agent.id}`,
    blurb,
    accent: statusAccent(status),
    rows: [
      { label: "Position", value: `(${fmt(agent.x, 1)}, ${fmt(agent.y, 1)})` },
      { label: "Heading", value: fmtRad(heading) },
      { label: "Speed", value: `${fmt(speed, 2)} m/tick` },
      { label: "Reputation", value: fmt(rep, 3), tone: status === "byzantine" ? "danger" : status === "flagged" ? "warn" : "accent" },
      { label: "Byz cutoff", value: fmt(byzantineThreshold, 2), tone: "mute" },
      { label: "Status", value: status.toUpperCase(), tone: status === "byzantine" ? "danger" : status === "flagged" ? "warn" : "accent" },
    ],
  };
}

export function observationHint(
  obs: Observation,
  observer: Agent,
  subject: Agent,
  tainted: boolean,
  observerRep: number,
): Hint {
  const trueRange = Math.hypot(subject.x - observer.x, subject.y - observer.y);
  const residual = obs.range_m - trueRange;
  return {
    title: `OBSERVATION · ${obs.observer_id} → ${obs.subject_id}`,
    blurb: tainted
      ? "A range claim from or about a peer the swarm distrusts. Tier-1 voting downweights it; Tier-2 MDS uses the residual against the embedding to find colluding pairs."
      : "A signed range+bearing measurement. Tier-1 cohort voting compares this against reciprocal claims; Tier-2 MDS checks that all ranges embed into a consistent 2-D geometry.",
    accent: tainted ? STATUS_BYZ : ACCENT,
    rows: [
      { label: "Claimed range", value: fmtMeters(obs.range_m), tone: "accent" },
      { label: "True range", value: fmtMeters(trueRange), tone: "mute" },
      { label: "Residual", value: fmtMeters(residual), tone: Math.abs(residual) > 0.5 ? "danger" : "mute" },
      { label: "Bearing", value: fmtRad(obs.bearing_rad) },
      { label: "Observer rep", value: fmt(observerRep, 3), tone: observerRep < 0.5 ? "warn" : "accent" },
    ],
  };
}

export function rangeCircleHint(obs: Observation): Hint {
  return {
    title: `RANGE CLAIM · ${obs.observer_id}`,
    blurb:
      "Locus of points consistent with this peer's claimed range — the subject should sit on this circle. Tier-2 MDS uses many such circles to test whether the swarm's measurements embed into a real 2-D geometry.",
    accent: STATUS_BYZ,
    rows: [
      { label: "Observer", value: obs.observer_id },
      { label: "Subject", value: obs.subject_id },
      { label: "Claimed range", value: fmtMeters(obs.range_m), tone: "danger" },
      { label: "Bearing", value: fmtRad(obs.bearing_rad) },
    ],
  };
}

export function rejectionHint(rejection: RejectionEvent): Hint {
  const extra: HintRow[] = [];
  if (rejection.originalSealTick !== undefined) {
    extra.push({
      label: "Original tick",
      value: String(rejection.originalSealTick),
      tone: "warn",
    });
  }
  if (rejection.causedByEvent !== undefined) {
    const labels: Record<typeof rejection.causedByEvent.kind, string> = {
      swap_key: "key rotated",
      replay_storm: "replay started",
      forged_envelope: "forged emitter armed",
    };
    extra.push({
      label: labels[rejection.causedByEvent.kind],
      value: `tick ${rejection.causedByEvent.atTick}`,
      tone: "warn",
    });
  }
  if (rejection.reason === "signature") {
    const sigBlurb =
      rejection.causedByEvent?.kind === "swap_key"
        ? "Sender rotated their keypair mid-mission; the receiver's roster still has the old pubkey, so every signature now fails verify. Recovery requires a re-keyed roster broadcast (ADR 0001)."
        : "Receiver ran ECDSA P-256 verify over the canonical envelope blob and the signature did not match. Either the message was tampered in flight, or the sender's pubkey isn't on the roster (lesson 13).";
    return {
      title: "✗ SIGNATURE INVALID",
      blurb: sigBlurb,
      accent: STATUS_BYZ,
      rows: [
        { label: "Reason", value: "signature", tone: "danger" },
        { label: "From", value: rejection.fromId },
        { label: "To", value: rejection.toId },
        { label: "Detail", value: rejection.detail, tone: "mute" },
        { label: "At tick", value: String(rejection.tick) },
        ...extra,
      ],
    };
  }
  const replayBlurb =
    rejection.originalSealTick !== undefined
      ? `Receiver's replay window had already seen the envelope sealed at tick ${rejection.originalSealTick}. The attacker re-broadcast a valid past message; the bound prevents it (ADR 0001).`
      : "Receiver's replay window had already seen this (sender, timestamp) tuple. An attacker tried to re-broadcast a valid past message; the bound prevents it (ADR 0001).";
  return {
    title: "✗ REPLAY DROPPED",
    blurb: replayBlurb,
    accent: STATUS_BYZ,
    rows: [
      { label: "Reason", value: "replay", tone: "danger" },
      { label: "From", value: rejection.fromId },
      { label: "To", value: rejection.toId },
      { label: "Detail", value: rejection.detail, tone: "mute" },
      { label: "At tick", value: String(rejection.tick) },
      ...extra,
    ],
  };
}

export function phantomHint(
  phantom: CopEntry,
  mapAttacks: ReadonlyArray<MapAttack>,
  reps: Record<string, number>,
): Hint {
  const label =
    mapAttacks.flatMap((m) => m.phantomContacts).find((p) => p.id === phantom.contactId)?.label ??
    phantom.contactId;
  const surviving = phantom.surviving;
  const threshold = 0.5;
  const confidenceRatio = phantom.trustWeight / threshold;
  const reporterRows: HintRow[] = phantom.reporters.map((r) => ({
    label: `↳ ${r}`,
    value: fmt(reps[r] ?? 0.5, 3),
    tone: (reps[r] ?? 0.5) < 0.5 ? "warn" : "mute",
  }));
  return {
    title: `PHANTOM CONTACT · ${label}`,
    blurb: surviving
      ? "A contact reported by one peer but not corroborated. The trust-weighted COP still shows it because the aggregate reporter reputation clears the cutoff — keep watching it."
      : "An injected map artifact that the COP filtered out: its aggregate trust-weighted evidence falls below the cutoff, so it doesn't appear in the operating picture.",
    accent: surviving ? STATUS_BYZ : MUTE,
    rows: [
      { label: "Reporters", value: String(phantom.reporters.length) },
      ...reporterRows,
      { label: "Position", value: `(${fmt(phantom.x, 1)}, ${fmt(phantom.y, 1)})` },
      { label: "Trust weight (Σrep)", value: fmt(phantom.trustWeight, 3), tone: surviving ? "warn" : "mute" },
      { label: "COP cutoff", value: fmt(threshold, 2), tone: "mute" },
      { label: "Confidence", value: `${fmt(confidenceRatio, 2)}× cutoff`, tone: surviving ? "danger" : "accent" },
      { label: "Status", value: surviving ? "SURVIVING" : "FILTERED", tone: surviving ? "danger" : "accent" },
    ],
  };
}

export function gossipPulseHint(
  gossiperId: string,
  receiverId: string,
  weight: number,
  subjectId: string | undefined,
  subjectView: [number, number] | undefined,
  isBoundary: boolean,
): Hint {
  const subjectRep =
    subjectView && subjectView[0] + subjectView[1] > 0
      ? subjectView[0] / (subjectView[0] + subjectView[1])
      : null;
  const damning = subjectRep !== null && subjectRep < 0.4;
  const blurb = isBoundary
    ? "A gossip edge that crosses a partition boundary. Direct observations don't flow here — this is the only path by which one clique learns what the other clique sees."
    : "During a gossip round, every agent broadcasts its Beta(α,β) snapshot and every other agent ingests it as discounted second-hand evidence. The receiver weights it by its own first-hand trust of the gossiper, ×0.10.";
  const rows: HintRow[] = [
    { label: "Gossiper", value: gossiperId, tone: "accent" },
    { label: "Receiver", value: receiverId },
    { label: "Weight", value: fmt(weight, 3), tone: weight < 0.02 ? "mute" : "accent" },
  ];
  if (subjectId && subjectView) {
    rows.push({ label: "Subject", value: subjectId, tone: damning ? "danger" : "accent" });
    rows.push({
      label: `View(${subjectId})`,
      value: `α=${fmt(subjectView[0], 2)} β=${fmt(subjectView[1], 2)}`,
      tone: damning ? "danger" : "mute",
    });
    if (subjectRep !== null) {
      rows.push({
        label: "Implied rep",
        value: fmt(subjectRep, 3),
        tone: damning ? "danger" : "accent",
      });
    }
  }
  return {
    title: `GOSSIP · ${gossiperId} → ${receiverId}${isBoundary ? " (boundary)" : ""}`,
    blurb,
    accent: isBoundary ? "var(--accent-warn)" : ACCENT,
    rows,
  };
}

export function cohortPulseHint(
  subjectId: string,
  tierUsed: "t1" | "t2" | "skip",
  observerCount: number,
  medianRangeM: number | null,
  embeddability: number | null,
  outlierIds: ReadonlyArray<string>,
): Hint {
  const blurb = !embeddability
    ? "A cohort closed: 3+ observers reported on this subject at the same timestamp. Tier-1 reciprocal-range voting compared each claim against the median. Outliers got β charged; agreers got α."
    : "Tier-2 MDS ran: the cohort's pairwise distances are projected to 2-D. Embeddability is the fit error — high values mean someone's claim contradicts the geometry. Lying-edge participants get β.";
  const rows: HintRow[] = [
    { label: "Subject", value: subjectId, tone: "accent" },
    { label: "Tier", value: tierUsed.toUpperCase(), tone: tierUsed === "t2" ? "warn" : "accent" },
    { label: "Observers", value: `${observerCount}` },
  ];
  if (medianRangeM !== null) rows.push({ label: "Median", value: fmtMeters(medianRangeM) });
  if (embeddability !== null)
    rows.push({
      label: "Embed",
      value: fmt(embeddability, 3),
      tone: embeddability > 0.05 ? "danger" : "mute",
    });
  if (outlierIds.length > 0)
    rows.push({ label: "Outliers", value: outlierIds.join(", "), tone: "danger" });
  return {
    title: `COHORT VOTE · ${subjectId}`,
    blurb,
    accent: tierUsed === "t2" ? "var(--accent-warn)" : ACCENT,
    rows,
  };
}

export function presenceHaloHint(subjectId: string, isPhantom: boolean): Hint {
  return {
    title: `NO PRESENCE · ${subjectId}`,
    blurb: isPhantom
      ? "A phantom agent. No real peer has beaconed it, so V3 transitive presence rejects it — every observation about this subject is charged β at observer and discards no Tier-1 weight. Mutual gossip between phantoms cannot manufacture presence."
      : "No real-agent granter in the last 2 s. V3 presence is currently failing for this subject — Tier-1 voting weight is gated to zero until a real beacon reaches it.",
    accent: STATUS_BYZ,
    rows: [{ label: "Subject", value: subjectId, tone: "danger" }],
  };
}

export function presenceArrowHint(
  observerId: string,
  subjectId: string,
  ageS: number,
  isObserverPhantom: boolean,
): Hint {
  return {
    title: `SEEN-BY · ${observerId} → ${subjectId}`,
    blurb: isObserverPhantom
      ? "A phantom claims to have observed this subject. V3 presence ignores it — a phantom is not a real-agent granter."
      : "A real-agent granter. As long as this edge is fresh (< 2 s), the subject has V3 presence and Tier-1 voting counts its claims at full weight.",
    accent: isObserverPhantom ? STATUS_BYZ : ACCENT,
    rows: [
      { label: "Observer", value: observerId, tone: isObserverPhantom ? "danger" : "accent" },
      { label: "Subject", value: subjectId },
      { label: "Age", value: `${ageS.toFixed(2)} s`, tone: ageS > 1.5 ? "warn" : "mute" },
      { label: "Window", value: "< 2.0 s", tone: "mute" },
    ],
  };
}

export function colluderEdgeHint(
  agentA: Agent,
  agentB: Agent,
  residual: number,
  embeddability: number,
): Hint {
  return {
    title: `COLLUDER EDGE · ${agentA.id} ↔ ${agentB.id}`,
    blurb:
      "Tier-2 MDS catches pairs whose mutual ranges don't fit any 2-D layout — they're agreeing about geometry that can't exist. This is the canonical colluder signature.",
    accent: STATUS_BYZ,
    rows: [
      { label: "Pair residual", value: fmtMeters(residual), tone: "danger" },
      { label: "Embeddability", value: fmt(embeddability, 3), tone: "danger" },
      { label: "Trip @", value: `≥ ${fmt(0.05, 2)}`, tone: "mute" },
    ],
  };
}

export function reciprocityGlyphHint(
  agentA: Agent,
  agentB: Agent,
  rangeAB: number,
  rangeBA: number,
  threshold: number,
): Hint {
  const delta = Math.abs(rangeAB - rangeBA);
  return {
    title: `RECIPROCITY · ${agentA.id} ⇄ ${agentB.id}`,
    blurb:
      "Tier-1 catches reciprocal-range disagreement. When both peers sense each other but report different distances, the cohort vote down-weights the outlier — that's how a single lying ray gets caught even when only one side fires.",
    accent: STATUS_FLAG,
    rows: [
      { label: `${agentA.id} → ${agentB.id}`, value: fmtMeters(rangeAB) },
      { label: `${agentB.id} → ${agentA.id}`, value: fmtMeters(rangeBA) },
      { label: "Mismatch", value: fmtMeters(delta), tone: "danger" },
      { label: "Trip @", value: `> ${fmtMeters(threshold)}`, tone: "mute" },
    ],
  };
}

export function externalEmitterHint(id: string): Hint {
  return {
    title: `EXTERNAL EMITTER · ${id}`,
    blurb:
      `Off-roster adversary broadcasting onto the bus. Every envelope from ${id} fails ECDSA verification at every receiver because there is no public key for ${id} in the signed roster — the wire layer drops the traffic before the trust evaluator sees it.`,
    accent: "var(--status-byzantine)",
    rows: [
      { label: "Source", value: "off-roster (no roster entry)" },
      { label: "Outcome", value: "✗ SIG INVALID at every receiver" },
    ],
  };
}

export function sensorFootprintHint(agent: Agent): Hint {
  return {
    title: `SENSOR FOOTPRINT · ${agent.id}`,
    blurb:
      "UWB ranging reach for this agent. Peers inside the circle can be range-observed and become cohort candidates for Tier-1 reciprocal-range voting.",
    accent: ACCENT,
    rows: [
      { label: "Radius", value: fmtMeters(AO_WORLD.sensorRadiusM) },
      { label: "Center", value: `(${fmt(agent.x, 1)}, ${fmt(agent.y, 1)})` },
    ],
  };
}

export function itemHint(
  item: Item,
  detected: boolean,
  observers: ReadonlyArray<string>,
  trustedCount: number,
  untrustedCount: number,
  suppressedBy: ReadonlyArray<string>,
  reps: Record<string, number>,
): Hint {
  const total = trustedCount + untrustedCount;
  const trustWeight = observers.reduce((sum, id) => sum + (reps[id] ?? 0.5), 0);
  const threshold = 0.5;
  const confidenceRatio = trustWeight / threshold;
  const surviving = trustWeight >= threshold;
  const blurb = !detected
    ? suppressedBy.length > 0
      ? "An item that real observers can see but a Byzantine peer is suppressing from the COP — they refuse to report it, so the swarm's operating picture has a blind spot."
      : "An item outside any agent's sensor footprint right now. Coverage gradually fills as agents traverse the AO."
    : untrustedCount > 0 && trustedCount === 0
      ? "Only low-reputation peers are reporting this item. The COP marks it as untrusted — possibly a planted false positive (lesson 08)."
      : untrustedCount > 0
        ? "A mix of trusted and untrusted reporters. Trust-weighted COP still surfaces this item because the trusted contributions clear the cutoff."
        : "Confirmed by reputable observers. Reported into the COP with full trust weight.";
  const kindBlurb: Record<string, string> = {
    building: "Static structure — landmark for map alignment.",
    vehicle: "Mobile contact — tracked across ticks.",
    uxo: "Unexploded ordnance — flagged for hazard avoidance.",
  };
  const kindNote = kindBlurb[item.kind] ?? "Generic map artifact.";
  const reporterRows: HintRow[] = observers.map((id) => ({
    label: `↳ ${id}`,
    value: fmt(reps[id] ?? 0.5, 3),
    tone: (reps[id] ?? 0.5) < 0.5 ? "warn" : "mute",
  }));
  const confidenceTone: HintRow["tone"] =
    untrustedCount > 0 && trustedCount === 0
      ? "danger"
      : !surviving
        ? "mute"
        : untrustedCount > 0
          ? "warn"
          : "accent";
  return {
    title: `${item.kind.toUpperCase()} · ${item.label}`,
    blurb: `${kindNote} ${blurb}`,
    accent:
      untrustedCount > 0 && trustedCount === 0
        ? STATUS_BYZ
        : untrustedCount > 0
          ? STATUS_FLAG
          : detected
            ? STATUS_OK
            : MUTE,
    rows: [
      { label: "Reporters", value: total === 0 ? "—" : `${trustedCount} trusted / ${untrustedCount} untrusted` },
      ...reporterRows,
      { label: "Suppressed by", value: suppressedBy.length > 0 ? suppressedBy.join(", ") : "—", tone: suppressedBy.length > 0 ? "danger" : "mute" },
      { label: "Trust weight (Σrep)", value: total === 0 ? "—" : fmt(trustWeight, 3), tone: total === 0 ? "mute" : "accent" },
      { label: "COP cutoff", value: fmt(threshold, 2), tone: "mute" },
      { label: "Confidence", value: total === 0 ? "—" : `${fmt(confidenceRatio, 2)}× cutoff`, tone: confidenceTone },
      { label: "Position", value: `(${fmt(item.x, 1)}, ${fmt(item.y, 1)})` },
      { label: "Detected", value: detected ? "YES" : "NO", tone: detected ? "accent" : "mute" },
    ],
  };
}

export function aoOutlineHint(): Hint {
  const { minX, maxX, minY, maxY } = AO_WORLD.bounds;
  return {
    title: "AREA OF OPERATIONS",
    blurb:
      "The mission boundary. Agents patrol inside, coverage is measured here, and the sector grid (A1, B2, …) keeps geometric and pedagogical reasoning anchored.",
    accent: ACCENT,
    rows: [
      { label: "Width", value: fmtMeters(maxX - minX) },
      { label: "Height", value: fmtMeters(maxY - minY) },
      { label: "Sector size", value: fmtMeters(AO_WORLD.sectorSize) },
    ],
  };
}

export function sectorHint(code: string): Hint {
  return {
    title: `SECTOR · ${code}`,
    blurb:
      "Grid cell used as a coarse geographic reference. Briefings and rejection messages name peers by sector to make spatial reasoning easier.",
    accent: MUTE,
    rows: [
      { label: "Cell size", value: fmtMeters(AO_WORLD.sectorSize) },
      { label: "Label", value: code },
    ],
  };
}

export function coverageHint(coveragePct: number): Hint {
  return {
    title: "COVERAGE FOG",
    blurb:
      "Unmapped terrain — no agent has ranged here yet. Fog clears permanently as the swarm patrols. Lesson 06 shows how a partition leaves persistent coverage gaps.",
    accent: MUTE,
    rows: [{ label: "AO mapped", value: fmtPct(coveragePct), tone: "mute" }],
  };
}
