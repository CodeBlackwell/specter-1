import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, CohortEvent, GossipIngest, Observation, TickSnapshot } from "@specter/sim-core";
import { AO_WORLD, type Item } from "./world";
import { type DetectionMap, observersAt } from "./detection";
import { type CoverageGrid, isCovered } from "./coverage";
import { type ContactReport, type CopEntry, type MapAttack, copView, COP_TRUST_THRESHOLD } from "./contacts";
import type { PhantomWitnessMap } from "./phantomWitnesses";
import { type RejectionEvent, rejectionsAt } from "./rejections";
import { useSimStore, useRumorSubject, useCliques } from "./simStore";
import { TIER1_THRESHOLD_M, TIER2_TAU, computeTrustView } from "./trust";
import { LESSON_NARRATION } from "../data/lessonNarration";
import { PRESENCE_WINDOW_NS } from "@specter/sim-core";
import {
  type Hint,
  type SetHint,
  HoverHintOverlay,
} from "./HoverHint";
import {
  agentHint,
  aoOutlineHint,
  cohortPulseHint,
  colluderEdgeHint,
  externalEmitterHint,
  gossipPulseHint,
  itemHint,
  observationHint,
  phantomHint,
  presenceArrowHint,
  presenceHaloHint,
  rangeCircleHint,
  reciprocityGlyphHint,
  rejectionHint,
  sectorHint,
  sensorFootprintHint,
} from "./swarmHints";

const EMPTY_AGENTS: ReadonlyArray<Agent> = [];
const EMPTY_OBSERVATIONS: ReadonlyArray<Observation> = [];
const EMPTY_REPS: Record<string, number> = {};
const EMPTY_MAP_ATTACKS: ReadonlyArray<MapAttack> = [];
const EMPTY_PHANTOM_WITNESSES: PhantomWitnessMap = {};
const EMPTY_REJECTIONS: ReadonlyArray<RejectionEvent> = [];
const EMPTY_COHORT_EVENTS: ReadonlyArray<CohortEvent> = [];

type Props = {
  snapshot: TickSnapshot | null;
  detectionMap?: DetectionMap;
  coverageGrid?: CoverageGrid;
  mapAttacks?: ReadonlyArray<MapAttack>;
  phantomWitnesses?: PhantomWitnessMap;
  contactReports?: ReadonlyArray<ContactReport>;
  rejections?: ReadonlyArray<RejectionEvent>;
  byzantineRepThreshold?: number;
  showRangeCircles?: boolean;
};

type DetectionState = {
  observers: ReadonlyArray<string>;
  trustedCount: number;
  untrustedCount: number;
  detected: boolean;
  suppressedBy: ReadonlyArray<string>;
};

type Status = "nominal" | "flagged" | "byzantine";

const PAD = 4;
const DRONE_R = 1.2;
const HEADING_LEN = 2.0;
const STROKE_THIN = 0.15;
const STROKE_THICK = 0.35;
const STROKE_X = 0.5;
const LABEL_FONT = 1.8;
const REP_FONT = 1.55;
const ITEM_LABEL_FONT = 1.25;

/** Pick a font size + line break that fits `label` inside an SVG `boxW × boxH`
 * region. Tries 1..N lines (N = word count), picks the layout with the largest
 * font size that still fits both width and height. Falls back to a single line
 * scaled down for single-word labels longer than the box. */
function fitLabel(
  label: string,
  boxW: number,
  boxH: number,
  maxFont = ITEM_LABEL_FONT,
): { lines: string[]; fontSize: number; lineHeight: number; yOffset: number } {
  const hpad = 1.2;
  const vpad = 0.8;
  const CHAR_W = 0.7;
  const LINE_RATIO = 1.15;
  const fitW = Math.max(0.5, boxW - hpad);
  const fitH = Math.max(0.5, boxH - vpad);
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: [label], fontSize: maxFont, lineHeight: maxFont * LINE_RATIO, yOffset: maxFont * 0.35 };
  }
  let best = { lines: [label], fontSize: 0, lineHeight: 0, yOffset: 0 };
  for (let n = 1; n <= words.length; n++) {
    const lines: string[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < words.length; i++) {
      lines[Math.floor((i * n) / words.length)]!.push(words[i]!);
    }
    const joined = lines.map((l) => l.join(" "));
    const longest = Math.max(...joined.map((l) => l.length));
    const fw = fitW / (longest * CHAR_W);
    const fh = fitH / (n * LINE_RATIO);
    const fontSize = Math.min(maxFont, fw, fh);
    if (fontSize > best.fontSize) {
      const lineHeight = fontSize * LINE_RATIO;
      const total = (n - 1) * lineHeight;
      best = { lines: joined, fontSize, lineHeight, yOffset: fontSize * 0.35 - total / 2 };
    }
  }
  return best;
}
const DASH_OBS = "0.6 0.8";
const SENSOR_DASH = "1.2 1.0";

function statusOf(rep: number, byzantineThreshold: number): Status {
  if (rep < byzantineThreshold) return "byzantine";
  if (rep < 0.55) return "flagged";
  return "nominal";
}

function statusColor(status: Status): string {
  if (status === "byzantine") return "var(--status-byzantine)";
  if (status === "flagged") return "var(--status-flagged)";
  return "var(--status-nominal)";
}

const TRUSTED_REP_THRESHOLD = 0.5;

function deriveDetections(
  detectionMap: DetectionMap | undefined,
  contactReports: ReadonlyArray<ContactReport> | undefined,
  currentTick: number,
  reps: Record<string, number>,
): Record<string, DetectionState> {
  const reportersByItem = new Map<string, Set<string>>();
  if (contactReports) {
    for (const r of contactReports) {
      if (r.kind !== "real") continue;
      if (r.firstReportedTick > currentTick) continue;
      if (!reportersByItem.has(r.contactId)) reportersByItem.set(r.contactId, new Set());
      reportersByItem.get(r.contactId)!.add(r.reporterId);
    }
  }
  const out: Record<string, DetectionState> = {};
  for (const item of AO_WORLD.items) {
    const physical = detectionMap ? observersAt(detectionMap, item.id, currentTick) : [];
    const reporters = reportersByItem.get(item.id) ?? new Set<string>();
    const observers = physical.filter((id) => reporters.has(id));
    const suppressedBy = physical.filter((id) => !reporters.has(id));
    let trustedCount = 0;
    let untrustedCount = 0;
    for (const obs of observers) {
      if ((reps[obs] ?? 1.0) >= TRUSTED_REP_THRESHOLD) trustedCount++;
      else untrustedCount++;
    }
    out[item.id] = {
      observers,
      trustedCount,
      untrustedCount,
      detected: observers.length > 0,
      suppressedBy,
    };
  }
  return out;
}

export function SwarmCanvas({
  snapshot,
  detectionMap,
  coverageGrid,
  mapAttacks = EMPTY_MAP_ATTACKS,
  phantomWitnesses = EMPTY_PHANTOM_WITNESSES,
  contactReports,
  rejections,
  byzantineRepThreshold = 0.4,
  showRangeCircles = false,
}: Props) {
  const bounds = useMemo(
    () => ({
      minX: AO_WORLD.bounds.minX - PAD,
      maxX: AO_WORLD.bounds.maxX + PAD,
      minY: AO_WORLD.bounds.minY - PAD,
      maxY: AO_WORLD.bounds.maxY + PAD,
    }),
    [],
  );

  const baseW = bounds.maxX - bounds.minX;
  const baseH = bounds.maxY - bounds.minY;
  const cx = bounds.minX + baseW / 2;
  const cy = bounds.minY + baseH / 2;

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, ox: 0, oy: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredOverlayKey, setHoveredOverlayKey] = useState<string | null>(null);
  const [hoveredPhantomId, setHoveredPhantomId] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const setPlaying = useSimStore((s) => s.setPlaying);
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const setSelectedAgent = useSimStore((s) => s.setSelectedAgent);
  const lessonId = useSimStore((s) => s.lessonId);
  const attackStartTickStore = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  const specAttackers = useSimStore((s) => s.spec?.attackers);
  const attackerIds = useMemo<ReadonlyArray<string>>(
    () =>
      specAttackers
        ? Array.from(new Set(specAttackers.map((a) => a.agentId).filter(Boolean)))
        : [],
    [specAttackers],
  );
  const pausedByClickRef = useRef(false);
  const pausedByHoverRef = useRef(false);
  const downAgentIdRef = useRef<string | null>(null);
  const downEdgeKeyRef = useRef<string | null>(null);

  // Only flag "we own this pause" when we actually transitioned playback from
  // playing → paused. If the user has manually paused (spacebar / overlay) we
  // leave the flag false, so the matching resume is a no-op and the user's
  // manual pause survives.
  const pauseFromClick = useCallback(() => {
    if (pausedByClickRef.current) return;
    if (!useSimStore.getState().isPlaying) return;
    setPlaying(false);
    pausedByClickRef.current = true;
  }, [setPlaying]);
  const resumeFromClick = useCallback(() => {
    if (!pausedByClickRef.current) return;
    pausedByClickRef.current = false;
    if (!pausedByHoverRef.current) setPlaying(true);
  }, [setPlaying]);

  const hoverPause = useCallback(() => {
    if (pausedByHoverRef.current) return;
    if (!useSimStore.getState().isPlaying) return;
    setPlaying(false);
    pausedByHoverRef.current = true;
  }, [setPlaying]);
  const hoverResume = useCallback(() => {
    if (!pausedByHoverRef.current) return;
    pausedByHoverRef.current = false;
    if (!pausedByClickRef.current) setPlaying(true);
  }, [setPlaying]);

  const setHoveredIdWithPause = useCallback(
    (id: string | null) => {
      if (id !== null) hoverPause();
      else hoverResume();
      setHoveredId(id);
    },
    [hoverPause, hoverResume],
  );
  const setHoveredEdgeKeyWithPause = useCallback(
    (key: string | null) => {
      if (key !== null) hoverPause();
      else hoverResume();
      setHoveredEdgeKey(key);
    },
    [hoverPause, hoverResume],
  );
  const setHoveredOverlayKeyWithPause = useCallback(
    (key: string | null) => {
      if (key !== null) hoverPause();
      else hoverResume();
      setHoveredOverlayKey(key);
    },
    [hoverPause, hoverResume],
  );
  const setHoveredPhantomIdWithPause = useCallback(
    (id: string | null) => {
      if (id !== null) hoverPause();
      else hoverResume();
      setHoveredPhantomId(id);
    },
    [hoverPause, hoverResume],
  );
  // Every overlay sets a hint on pointer-enter and clears it on pointer-leave.
  // Couple hover-pause to the hint state so the dozens of secondary overlays
  // (gossip pulses, colluder chord, cohort rays, presence arrows, etc.) all
  // pause playback while the cursor is on them, matching the agent/edge
  // behaviour without needing per-component wiring.
  const setHintWithPause = useCallback<SetHint>(
    (h) => {
      if (h !== null) hoverPause();
      else hoverResume();
      setHint(h);
    },
    [hoverPause, hoverResume],
  );
  useEffect(() => {
    return () => {
      if (pausedByHoverRef.current) {
        pausedByHoverRef.current = false;
        setPlaying(true);
      }
    };
  }, [setPlaying]);

  // Single source of truth: selecting anything pauses, clearing everything resumes.
  const applySelection = useCallback(
    (agentId: string | null, edgeKey: string | null) => {
      setSelectedAgent(agentId);
      setSelectedEdgeKey(edgeKey);
      if (agentId !== null || edgeKey !== null) pauseFromClick();
      else resumeFromClick();
    },
    [setSelectedAgent, pauseFromClick, resumeFromClick],
  );
  const handleAgentClick = useCallback(
    (id: string) => {
      if (selectedAgentId === id) applySelection(null, null);
      else applySelection(id, null);
    },
    [selectedAgentId, applySelection],
  );
  const handleEdgeClick = useCallback(
    (key: string) => {
      if (selectedEdgeKey === key) applySelection(null, null);
      else applySelection(null, key);
    },
    [selectedEdgeKey, applySelection],
  );
  useEffect(() => {
    return () => {
      if (pausedByClickRef.current) {
        pausedByClickRef.current = false;
        setPlaying(true);
      }
    };
  }, [setPlaying]);

  const w = baseW / view.scale;
  const h = baseH / view.scale;
  const vbMinX = cx - w / 2 + view.ox;
  const vbMinY = cy - h / 2 + view.oy;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const worldX = vbMinX + fx * w;
      const worldY = vbMinY + fy * h;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.max(0.3, Math.min(12, view.scale * factor));
      const newW = baseW / newScale;
      const newH = baseH / newScale;
      const newOx = worldX - fx * newW - cx + newW / 2;
      const newOy = worldY - fy * newH - cy + newH / 2;
      setView({ scale: newScale, ox: newOx, oy: newOy });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view.scale, vbMinX, vbMinY, w, h, baseW, baseH, cx, cy]);

  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    downPosRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    const target = e.target as Element | null;
    const agentEl = (target?.closest?.("[data-agent-id]") as HTMLElement | null) ?? null;
    const edgeEl = (target?.closest?.("[data-edge-key]") as HTMLElement | null) ?? null;
    downAgentIdRef.current = agentEl?.dataset.agentId ?? null;
    downEdgeKeyRef.current = agentEl ? null : (edgeEl?.dataset.edgeKey ?? null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const start = downPosRef.current;
    if (start && (Math.abs(e.clientX - start.x) > 3 || Math.abs(e.clientY - start.y) > 3)) {
      movedRef.current = true;
    }
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = -((e.clientX - drag.x) / rect.width) * w;
    const dy = -((e.clientY - drag.y) / rect.height) * h;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const moved = movedRef.current;
    const downId = downAgentIdRef.current;
    const downEdge = downEdgeKeyRef.current;
    dragRef.current = null;
    downPosRef.current = null;
    downAgentIdRef.current = null;
    downEdgeKeyRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (moved) return;
    if (downId) handleAgentClick(downId);
    else if (downEdge) handleEdgeClick(downEdge);
    else applySelection(null, null);
  };

  const resetView = () => setView({ scale: 1, ox: 0, oy: 0 });
  const isZoomed = view.scale !== 1 || view.ox !== 0 || view.oy !== 0;

  const agents = snapshot?.agents ?? EMPTY_AGENTS;
  const observations = snapshot?.observations ?? EMPTY_OBSERVATIONS;
  const reps = snapshot?.consensusReputations ?? snapshot?.reputations ?? EMPTY_REPS;
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const byzantineIds = useMemo(
    () =>
      new Set(
        agents.filter((a) => (reps[a.id] ?? 1.0) < byzantineRepThreshold).map((a) => a.id),
      ),
    [agents, reps, byzantineRepThreshold],
  );

  const currentTick = snapshot?.tick ?? 0;
  const detections = useMemo(
    () => deriveDetections(detectionMap, contactReports, currentTick, reps),
    [detectionMap, contactReports, currentTick, reps],
  );

  const trustView = useMemo(() => computeTrustView(snapshot ?? null), [snapshot]);
  // Agents the trust layer is *actively* flagging right now: Tier-1 (per-pair
  // reciprocity gap above threshold, any time in the recent window with a
  // freshness fade) and Tier-2 (the colluder chord's endpoints while
  // embeddability > τ). Powers the "who is being accused" halo on AgentNode
  // so the demonstration doesn't rely on the viewer noticing tiny glyphs.
  const rumorSubject = useRumorSubject();
  const cliques = useCliques();
  const cliqueOf = useMemo(() => {
    if (!cliques) return null;
    const m = new Map<string, number>();
    cliques.forEach((group, i) => group.forEach((id) => m.set(id, i)));
    return m;
  }, [cliques]);
  const effectiveRumorSubject = useMemo<string | undefined>(() => {
    if (rumorSubject) return rumorSubject;
    if (!snapshot) return undefined;
    let worstId: string | undefined;
    let worstRep = Infinity;
    for (const a of snapshot.agents) {
      if (a.phantom) continue;
      const r = snapshot.consensusReputations[a.id] ?? snapshot.reputations[a.id] ?? 0.5;
      if (r < worstRep) {
        worstRep = r;
        worstId = a.id;
      }
    }
    return worstRep < 0.5 ? worstId : undefined;
  }, [rumorSubject, snapshot]);
  const cop = useMemo<CopEntry[]>(
    () => (contactReports ? copView(contactReports, currentTick, reps) : []),
    [contactReports, currentTick, reps],
  );
  const phantomCop = useMemo(() => cop.filter((c) => c.kind === "phantom"), [cop]);
  const activeRejections = useMemo(
    () => (rejections ? rejectionsAt(rejections, currentTick) : []),
    [rejections, currentTick],
  );
  // Freeze ghost positions: agents move every tick, so a print of a past
  // rejection must remember where both endpoints were *at that tick*. Build
  // a tick→snapshot lookup once and resolve from/to positions against it.
  const allSnapshots = useSimStore((s) => s.result?.snapshots);
  const snapshotByTick = useMemo(() => {
    const m = new Map<number, TickSnapshot>();
    if (allSnapshots) for (const s of allSnapshots) m.set(s.tick, s);
    return m;
  }, [allSnapshots]);
  // Snapshots in the recent window — used by persistent overlays (Tier-1
  // reciprocity chevrons) so a per-tick flag stays visible long enough to
  // see, with age-based fade.
  const recentSnapshots = useMemo(() => {
    if (!allSnapshots) return [] as TickSnapshot[];
    const lo = currentTick - RECIPROCITY_GLYPH_LIFESPAN;
    return allSnapshots.filter((s) => s.tick > lo && s.tick <= currentTick);
  }, [allSnapshots, currentTick]);
  const flaggedAgents = useMemo(() => {
    const m = new Map<string, { tier1Fresh: number; tier2: boolean }>();
    const bump = (id: string, patch: Partial<{ tier1Fresh: number; tier2: boolean }>) => {
      const prev = m.get(id) ?? { tier1Fresh: 0, tier2: false };
      m.set(id, {
        tier1Fresh: Math.max(prev.tier1Fresh, patch.tier1Fresh ?? 0),
        tier2: prev.tier2 || (patch.tier2 ?? false),
      });
    };
    // Tier-1: union of every reciprocal pair flagged in the recent window,
    // freshness driven by the most-recent fire-tick per agent.
    for (const snap of recentSnapshots) {
      const buckets = new Map<
        string,
        { obsAB?: Observation; obsBA?: Observation; A: string; B: string }
      >();
      for (const o of snap.observations) {
        if (o.observer_id === o.subject_id) continue;
        const A = o.observer_id < o.subject_id ? o.observer_id : o.subject_id;
        const B = o.observer_id < o.subject_id ? o.subject_id : o.observer_id;
        const key = `${A}|${B}|${o.timestamp_ns.toString()}`;
        const entry = buckets.get(key) ?? { A, B };
        if (o.observer_id === A) entry.obsAB = o;
        else entry.obsBA = o;
        buckets.set(key, entry);
      }
      for (const { obsAB, obsBA, A, B } of buckets.values()) {
        if (!obsAB || !obsBA) continue;
        if (Math.abs(obsAB.range_m - obsBA.range_m) <= TIER1_THRESHOLD_M) continue;
        const ageTicks = Math.max(0, currentTick - snap.tick);
        const freshness = 1 - Math.min(1, ageTicks / RECIPROCITY_GLYPH_LIFESPAN);
        bump(A, { tier1Fresh: freshness });
        bump(B, { tier1Fresh: freshness });
      }
    }
    // Tier-2: colluder chord endpoints while embeddability > τ.
    if (trustView.embeddability >= TIER2_TAU && trustView.tier2Top) {
      const a = trustView.agentIds[trustView.tier2Top.i];
      const b = trustView.agentIds[trustView.tier2Top.j];
      if (a) bump(a, { tier2: true });
      if (b) bump(b, { tier2: true });
    }
    return m;
  }, [recentSnapshots, currentTick, trustView]);
  // Pedagogical phantoms: every past rejection leaves a faded artifact on the
  // canvas so the learner can see *where* the wire-layer caught lies. Dedup
  // by (attack vector × spatial grid cell) so a 500-tick replay storm leaves
  // distinct prints along the receiver's path through the AO instead of one
  // ghost per pair or 250 stacked X marks at the same coordinate. Each print
  // has a 30-tick lifespan: opacity fades linearly to zero over its lifetime
  // so a paused attack vector decays off the map naturally.
  const ghostRejections = useMemo(() => {
    if (!rejections) return [] as Array<{ ev: RejectionEvent; ageFrac: number }>;
    const CELL = 6;
    const LIFESPAN = 30;
    const out = new Map<string, RejectionEvent>();
    for (const ev of rejections) {
      if (ev.tick >= currentTick) continue;
      if (ev.tick < currentTick - LIFESPAN) continue;
      const frozen = snapshotByTick.get(ev.tick);
      const frozenFrom = frozen?.agents.find((a) => a.id === ev.fromId);
      const frozenTo = frozen?.agents.find((a) => a.id === ev.toId);
      const fromX = ev.fromX ?? frozenFrom?.x;
      const fromY = ev.fromY ?? frozenFrom?.y;
      if (fromX === undefined || fromY === undefined || !frozenTo) continue;
      const mx = (fromX + frozenTo.x) / 2;
      const my = (fromY + frozenTo.y) / 2;
      const cx = Math.floor(mx / CELL);
      const cy = Math.floor(my / CELL);
      const key = `${ev.fromId}->${ev.toId}:${ev.reason}:${cx},${cy}`;
      // Always overwrite — latest occurrence in a cell wins, so an attack
      // vector that keeps firing re-anchors the print and resets its age.
      out.set(key, ev);
    }
    return [...out.values()].map((ev) => ({
      ev,
      ageFrac: Math.min(1, Math.max(0, (currentTick - ev.tick) / LIFESPAN)),
    }));
  }, [rejections, currentTick, snapshotByTick]);

  // External (off-roster) emitters — any rejection with literal fromX/fromY
  // describes a source that isn't a real drone. Surface a small adversary
  // marker at each unique (id, x, y) so the rejection lines have a visible
  // origin instead of radiating from an apparent void at the AO edge.
  const externalEmitters = useMemo(() => {
    if (!rejections) return [];
    const LIFESPAN = 30;
    const seen = new Map<string, { id: string; x: number; y: number }>();
    for (const ev of rejections) {
      if (ev.fromX == null || ev.fromY == null) continue;
      if (ev.tick > currentTick) continue;
      if (ev.tick < currentTick - LIFESPAN) continue;
      const key = `${ev.fromId}:${ev.fromX},${ev.fromY}`;
      if (!seen.has(key)) seen.set(key, { id: ev.fromId, x: ev.fromX, y: ev.fromY });
    }
    return [...seen.values()];
  }, [rejections, currentTick]);

  // Cleanup: when a ghost expires while a pointer is still on it (e.g. paused
  // mid-hover then scrubbed forward, or selection sticky across a tick scrub),
  // the marker unmounts but pointerleave never fires. Drop any stale hover /
  // selection that points at a rejection key the render set no longer contains.
  useEffect(() => {
    const valid = new Set<string>();
    for (const { ev } of ghostRejections) {
      valid.add(`rej-ghost:${ev.tick}:${ev.fromId}->${ev.toId}:${ev.reason}`);
    }
    for (const r of activeRejections) {
      valid.add(`rej:${r.tick}:${r.fromId}->${r.toId}:${r.reason}`);
    }
    if (
      hoveredEdgeKey &&
      (hoveredEdgeKey.startsWith("rej:") || hoveredEdgeKey.startsWith("rej-ghost:")) &&
      !valid.has(hoveredEdgeKey)
    ) {
      setHoveredEdgeKeyWithPause(null);
    }
    if (
      selectedEdgeKey &&
      (selectedEdgeKey.startsWith("rej:") || selectedEdgeKey.startsWith("rej-ghost:")) &&
      !valid.has(selectedEdgeKey)
    ) {
      setSelectedEdgeKey(null);
    }
  }, [
    ghostRejections,
    activeRejections,
    hoveredEdgeKey,
    selectedEdgeKey,
    setHoveredEdgeKeyWithPause,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}
    >
      <svg
        ref={svgRef}
        viewBox={`${vbMinX} ${vbMinY} ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: "100%",
          height: "100%",
          background: "var(--surface-1)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
          display: "block",
          cursor: dragRef.current ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        <SectorGrid setHint={setHintWithPause} />
        <AOOutline setHint={setHintWithPause} />
        <Items
          items={AO_WORLD.items}
          detections={detections}
          reps={reps}
          setHint={setHintWithPause}
        />
        <Fog grid={coverageGrid} currentTick={currentTick} />
        <Phantoms
          phantoms={phantomCop}
          mapAttacks={mapAttacks}
          reps={reps}
          onHover={setHoveredPhantomIdWithPause}
          setHint={setHintWithPause}
        />
        <PresenceOverlay
          snapshot={snapshot}
          agentById={agentById}
          hoveredId={hoveredId}
          setHint={setHintWithPause}
        />
        {snapshot?.gossipRound ? (
          <GossipPulses
            tick={currentTick}
            ingested={snapshot.gossipIngested}
            agentById={agentById}
            rumorSubject={effectiveRumorSubject}
            cliqueOf={cliqueOf}
            setHint={setHintWithPause}
            hoveredEdgeKey={hoveredEdgeKey}
            selectedEdgeKey={selectedEdgeKey}
            onEdgeHover={setHoveredEdgeKeyWithPause}
          />
        ) : null}
        <SensorFootprints
          agents={agents}
          setHint={setHintWithPause}
          hoveredOverlayKey={hoveredOverlayKey}
          onOverlayHover={setHoveredOverlayKeyWithPause}
        />
        <ObservationLines
          observations={observations}
          agentById={agentById}
          byzantineIds={byzantineIds}
          hoveredId={hoveredId}
          reps={reps}
          setHint={setHintWithPause}
          hoveredEdgeKey={hoveredEdgeKey}
          selectedEdgeKey={selectedEdgeKey}
          onEdgeHover={setHoveredEdgeKeyWithPause}
        />
        {showRangeCircles
          ? observations
              .filter((o) => byzantineIds.has(o.observer_id) || byzantineIds.has(o.subject_id))
              .map((obs, i) => (
                <RangeCircle
                  key={`rc-${i}`}
                  obs={obs}
                  agentById={agentById}
                  setHint={setHintWithPause}
                />
              ))
          : null}
        {hoveredId
          ? observations
              .filter((o) => o.observer_id === hoveredId)
              .map((obs, i) => (
                <PerspectiveRangeCircle
                  key={`prc-${i}`}
                  obs={obs}
                  agentById={agentById}
                  setHint={setHintWithPause}
                />
              ))
          : null}
        {hoveredId
          ? observations
              .filter((o) => o.observer_id === hoveredId)
              .map((obs, i) => (
                <PerspectiveEdge
                  key={`pe-${i}`}
                  obs={obs}
                  agentById={agentById}
                  setHint={setHintWithPause}
                />
              ))
          : null}
        <ReciprocityGlyphs
          recentSnapshots={recentSnapshots}
          agentById={agentById}
          currentTick={currentTick}
          setHint={setHintWithPause}
        />
        <ColluderEdge
          trustView={trustView}
          agentById={agentById}
          setHint={setHintWithPause}
          hoveredOverlayKey={hoveredOverlayKey}
          onOverlayHover={setHoveredOverlayKeyWithPause}
        />
        <ColluderLieArtifact
          lessonId={lessonId}
          attackerIds={attackerIds}
          currentTick={currentTick}
          attackStartTick={attackStartTickStore}
          agentById={agentById}
          recentSnapshots={recentSnapshots}
        />
        <CohortPulses
          tick={currentTick}
          events={snapshot?.newCohortEvents ?? EMPTY_COHORT_EVENTS}
          agentById={agentById}
          setHint={setHintWithPause}
          hoveredOverlayKey={hoveredOverlayKey}
          onOverlayHover={setHoveredOverlayKeyWithPause}
        />
        <AttackIgnition snapshot={snapshot} agents={agents} byzantineIds={byzantineIds} />
        <GhostRejections
          ghosts={ghostRejections}
          agentById={agentById}
          snapshotByTick={snapshotByTick}
          setHint={setHintWithPause}
          hoveredEdgeKey={hoveredEdgeKey}
          selectedEdgeKey={selectedEdgeKey}
          onEdgeHover={setHoveredEdgeKeyWithPause}
        />
        <Rejections
          rejections={activeRejections}
          agentById={agentById}
          snapshotByTick={snapshotByTick}
          setHint={setHintWithPause}
          hoveredEdgeKey={hoveredEdgeKey}
          selectedEdgeKey={selectedEdgeKey}
          onEdgeHover={setHoveredEdgeKeyWithPause}
        />
        <ExternalEmitters emitters={externalEmitters} setHint={setHintWithPause} />
        {agents.map((a) => {
          const focusId = hoveredId ?? selectedAgentId;
          const flag = flaggedAgents.get(a.id);
          return (
            <AgentNode
              key={a.id}
              agent={a}
              rep={reps[a.id] ?? 0.5}
              status={statusOf(reps[a.id] ?? 0.5, byzantineRepThreshold)}
              hovered={focusId === a.id}
              dimmed={focusId !== null && focusId !== a.id}
              flagTier1Fresh={flag?.tier1Fresh ?? 0}
              flagTier2={flag?.tier2 ?? false}
              onHover={setHoveredIdWithPause}
              setHint={setHintWithPause}
            />
          );
        })}
      </svg>
      <HoverHintOverlay hint={hint} containerRef={containerRef} pinned />
      {hint ? null : <Legend />}
      <NarrationBanner lessonId={lessonId} currentTick={currentTick} />
      <MapStatusOverlay
        detections={detections}
        hoveredId={hoveredId}
        coverageGrid={coverageGrid}
        currentTick={currentTick}
        phantomCop={phantomCop}
        mapAttacks={mapAttacks}
      />
      <ZoomBadge scale={view.scale} isZoomed={isZoomed} onReset={resetView} />
      <PerspectiveBadge hoveredId={hoveredId} snapshot={snapshot} />
      <PhantomDetailCard
        phantomId={hoveredPhantomId}
        phantoms={phantomCop}
        mapAttacks={mapAttacks}
        witnessMap={phantomWitnesses}
        reps={reps}
        agents={agents}
      />
    </div>
  );
}

const GOSSIP_PULSE_MS = 700;
const GOSSIP_PULSE_R = 0.7;
const GOSSIP_BYZ_REP_FLOOR = 0.4;

const GossipPulses = memo(function GossipPulses({
  tick,
  ingested,
  agentById,
  rumorSubject,
  cliqueOf,
  setHint,
  hoveredEdgeKey,
  selectedEdgeKey,
  onEdgeHover,
}: {
  tick: number;
  ingested: ReadonlyArray<GossipIngest>;
  agentById: Map<string, Agent>;
  rumorSubject: string | undefined;
  cliqueOf: Map<string, number> | null;
  setHint: SetHint;
  hoveredEdgeKey: string | null;
  selectedEdgeKey: string | null;
  onEdgeHover: (key: string | null) => void;
}) {
  type Edge = {
    key: string;
    g: Agent;
    r: Agent;
    weight: number;
    boundary: boolean;
    subjectView: [number, number] | undefined;
    damning: boolean;
    gossiperId: string;
    receiverId: string;
  };
  const edges: Edge[] = [];
  for (const ing of ingested) {
    const g = agentById.get(ing.gossiperId);
    const r = agentById.get(ing.receiverId);
    if (!g || !r) continue;
    const boundary =
      cliqueOf !== null &&
      cliqueOf.has(ing.gossiperId) &&
      cliqueOf.has(ing.receiverId) &&
      cliqueOf.get(ing.gossiperId) !== cliqueOf.get(ing.receiverId);
    const subjectView = rumorSubject ? ing.views[rumorSubject] : undefined;
    const total = subjectView ? subjectView[0] + subjectView[1] : 0;
    const impliedRep = total > 0 ? subjectView![0] / total : 0.5;
    const damning =
      rumorSubject !== undefined && subjectView !== undefined && impliedRep < GOSSIP_BYZ_REP_FLOOR;
    edges.push({
      key: `gossip:${tick}:${ing.gossiperId}->${ing.receiverId}`,
      g,
      r,
      weight: ing.weight,
      boundary,
      subjectView,
      damning,
      gossiperId: ing.gossiperId,
      receiverId: ing.receiverId,
    });
  }
  return (
    <g>
      {edges.map((e) => {
        const lit = hoveredEdgeKey === e.key || selectedEdgeKey === e.key;
        const stroke = e.boundary ? "var(--accent-warn)" : "var(--accent-primary)";
        const pulseFill = e.damning ? "var(--status-byzantine)" : stroke;
        const baseOpacity = Math.min(0.6, Math.max(0.05, e.weight * 4));
        return (
          <g key={e.key} data-edge-key={e.key} style={{ cursor: "pointer" }}>
            <line
              x1={e.g.x}
              y1={e.g.y}
              x2={e.r.x}
              y2={e.r.y}
              stroke={stroke}
              strokeWidth={e.boundary ? (lit ? 0.45 : 0.3) : lit ? 0.4 : 0.16}
              strokeOpacity={lit ? 1.0 : baseOpacity}
              strokeDasharray={e.boundary ? undefined : "0.5 0.7"}
            />
            <circle r={GOSSIP_PULSE_R} fill={pulseFill} opacity={Math.min(1, e.weight * 6 + 0.2)}>
              <animate
                attributeName="cx"
                from={e.g.x}
                to={e.r.x}
                dur={`${GOSSIP_PULSE_MS}ms`}
                begin="0s"
                repeatCount="1"
                fill="freeze"
              />
              <animate
                attributeName="cy"
                from={e.g.y}
                to={e.r.y}
                dur={`${GOSSIP_PULSE_MS}ms`}
                begin="0s"
                repeatCount="1"
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.15;0.85;1"
                dur={`${GOSSIP_PULSE_MS}ms`}
                begin="0s"
                repeatCount="1"
                fill="freeze"
              />
            </circle>
            <line
              x1={e.g.x}
              y1={e.g.y}
              x2={e.r.x}
              y2={e.r.y}
              stroke="transparent"
              strokeWidth={1.6}
              onPointerEnter={() => {
                onEdgeHover(e.key);
                setHint(
                  gossipPulseHint(e.gossiperId, e.receiverId, e.weight, rumorSubject, e.subjectView, e.boundary),
                );
              }}
              onPointerLeave={() => {
                onEdgeHover(null);
                setHint(null);
              }}
            />
          </g>
        );
      })}
    </g>
  );
});

const ColluderEdge = memo(function ColluderEdge({
  trustView,
  agentById,
  setHint,
  hoveredOverlayKey,
  onOverlayHover,
}: {
  trustView: ReturnType<typeof computeTrustView>;
  agentById: Map<string, Agent>;
  setHint: SetHint;
  hoveredOverlayKey: string | null;
  onOverlayHover: (key: string | null) => void;
}) {
  if (trustView.embeddability < TIER2_TAU) return null;
  const top = trustView.tier2Top;
  if (!top) return null;
  const a = agentById.get(trustView.agentIds[top.i]!);
  const b = agentById.get(trustView.agentIds[top.j]!);
  if (!a || !b) return null;
  const key = `colluder:${a.id}-${b.id}`;
  const lit = hoveredOverlayKey === key;
  return (
    <g>
      {/* Wide soft halo so the chord stands out against observation traffic
          even at default zoom. Always-on; the previous render only showed it
          on hover, which made the L3 demonstration easy to miss. */}
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="var(--accent-warn)"
        strokeWidth={lit ? 1.8 : 1.2}
        strokeOpacity={lit ? 0.35 : 0.22}
        strokeLinecap="round"
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="var(--accent-warn)"
        strokeWidth={lit ? 1.1 : 0.75}
        strokeOpacity={lit ? 0.95 : 0.82}
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="var(--surface-0)"
        strokeWidth={lit ? 0.45 : 0.3}
        strokeOpacity={1.0}
        strokeDasharray="1.6 0.8"
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="transparent"
        strokeWidth={2.0}
        style={{ cursor: "help" }}
        onPointerEnter={() => {
          onOverlayHover(key);
          setHint(colluderEdgeHint(a, b, top.residual, trustView.embeddability));
        }}
        onPointerLeave={() => {
          onOverlayHover(null);
          setHint(null);
        }}
      />
    </g>
  );
});

/** L3-only "what's the lie?" artifact. Two colluding peers report a mutually
 *  inflated range; the trust layer's Tier-2 chord only surfaces once MDS
 *  embeddability crosses τ, which can be many seconds after ignition. This
 *  overlay makes the *content* of the lie visible immediately: dashed ghost
 *  positions for where each agent claims the other is, anchored at the
 *  empirically observed inflation magnitude. Reads regardless of detection
 *  state — explanatory, not diagnostic.
 */
const ColluderLieArtifact = memo(function ColluderLieArtifact({
  lessonId,
  attackerIds,
  currentTick,
  attackStartTick,
  agentById,
  recentSnapshots,
}: {
  lessonId: string | null;
  attackerIds: ReadonlyArray<string>;
  currentTick: number;
  attackStartTick: number;
  agentById: Map<string, Agent>;
  recentSnapshots: ReadonlyArray<TickSnapshot>;
}) {
  if (lessonId !== "03") return null;
  if (currentTick < attackStartTick) return null;
  if (attackerIds.length < 2) return null;
  const aId = attackerIds[0]!;
  const bId = attackerIds[1]!;
  const a = agentById.get(aId);
  const b = agentById.get(bId);
  if (!a || !b) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const trueD = Math.hypot(dx, dy);
  if (trueD < 0.5) return null;

  // Estimate the inflation magnitude from observations across the recent
  // window (more stable than a single tick, which may have zero pairwise
  // observations or only one direction).
  let total = 0;
  let count = 0;
  for (const snap of recentSnapshots) {
    for (const o of snap.observations) {
      const matches =
        (o.observer_id === aId && o.subject_id === bId) ||
        (o.observer_id === bId && o.subject_id === aId);
      if (!matches) continue;
      total += o.range_m;
      count++;
    }
  }
  if (count === 0) return null;
  const avgReported = total / count;
  const inflation = avgReported - trueD;
  if (inflation < 1.0) return null; // below noise floor — nothing to show
  const reportedD = trueD + inflation;

  const ux = dx / trueD;
  const uy = dy / trueD;
  // Each ghost sits along the agent→peer ray at the *claimed* distance.
  const ghostBx = a.x + ux * reportedD; // A claims B is here
  const ghostBy = a.y + uy * reportedD;
  const ghostAx = b.x - ux * reportedD; // B claims A is here
  const ghostAy = b.y - uy * reportedD;
  // Perpendicular for label offset
  const nx = -uy;
  const ny = ux;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const labelOffset = 3.0;
  const labelX = midX + nx * labelOffset;
  const labelY = midY + ny * labelOffset;
  const label = `REPORTED +${inflation.toFixed(1)} m`;
  // Approximate label width for the backdrop rect (monospace, ~0.78 em wide).
  const labelW = label.length * 0.78 + 1.4;

  return (
    <g>
      {/* Stretched dashed rays from each true agent to its ghost. These are
          the lying claims rendered in space. */}
      <line
        x1={b.x}
        y1={b.y}
        x2={ghostBx}
        y2={ghostBy}
        stroke="var(--accent-warn)"
        strokeWidth={0.45}
        strokeOpacity={0.9}
        strokeDasharray="1.0 0.55"
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={ghostAx}
        y2={ghostAy}
        stroke="var(--accent-warn)"
        strokeWidth={0.45}
        strokeOpacity={0.9}
        strokeDasharray="1.0 0.55"
      />
      {/* Ghost markers at the claimed peer positions. */}
      <ColluderGhostMarker x={ghostBx} y={ghostBy} label={`${aId} claims ${bId}`} />
      <ColluderGhostMarker x={ghostAx} y={ghostAy} label={`${bId} claims ${aId}`} />
      {/* Inflation label at perpendicular offset from the true segment. */}
      <rect
        x={labelX - labelW / 2}
        y={labelY - 1.1}
        width={labelW}
        height={2.0}
        fill="rgba(11,13,16,0.88)"
        stroke="var(--accent-warn)"
        strokeOpacity={0.55}
        strokeWidth={0.12}
        rx={0.5}
      />
      <text
        x={labelX}
        y={labelY + 0.45}
        fontSize={1.35}
        fill="var(--accent-warn)"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fontWeight={700}
      >
        {label}
      </text>
      {/* Colluder tags above each real agent — accent-warn so they're
          distinct from the existing accusation halos (those fire only
          after the trust layer has noticed). */}
      <ColluderTag x={a.x} y={a.y} />
      <ColluderTag x={b.x} y={b.y} />
    </g>
  );
});

function ColluderGhostMarker({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={DRONE_R * 1.4}
        fill="var(--accent-warn)"
        fillOpacity={0.10}
        stroke="var(--accent-warn)"
        strokeOpacity={0.8}
        strokeWidth={0.25}
        strokeDasharray="0.55 0.45"
      />
      <text
        x={x}
        y={y + DRONE_R * 1.4 + 1.4}
        fontSize={1.05}
        fill="var(--accent-warn)"
        fillOpacity={0.92}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        letterSpacing={0.12}
      >
        {label}
      </text>
    </g>
  );
}

function ColluderTag({ x, y }: { x: number; y: number }) {
  // Sits just above the agent ID label rendered inside AgentNode (which is
  // at y - DRONE_R - 1.2 at fontSize LABEL_FONT=1.8). Stack one row higher.
  const tagY = y - DRONE_R - 1.2 - LABEL_FONT - 0.4;
  const tagW = 4.2;
  return (
    <g pointerEvents="none">
      <rect
        x={x - tagW / 2}
        y={tagY - 1.0}
        width={tagW}
        height={1.6}
        fill="rgba(11,13,16,0.85)"
        stroke="var(--accent-warn)"
        strokeOpacity={0.6}
        strokeWidth={0.12}
        rx={0.3}
      />
      <text
        x={x}
        y={tagY + 0.18}
        fontSize={1.0}
        fill="var(--accent-warn)"
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fontWeight={700}
        letterSpacing={0.2}
      >
        COLLUDER
      </text>
    </g>
  );
}

export const RECIPROCITY_GLYPH_LIFESPAN = 30;

const ReciprocityGlyphs = memo(function ReciprocityGlyphs({
  recentSnapshots,
  agentById,
  currentTick,
  setHint,
}: {
  recentSnapshots: ReadonlyArray<TickSnapshot>;
  agentById: Map<string, Agent>;
  currentTick: number;
  setHint: SetHint;
}) {
  type Hit = {
    key: string;
    a: Agent;
    b: Agent;
    rangeAB: number;
    rangeBA: number;
    delta: number;
    lastTick: number;
  };
  // Scan the last LIFESPAN ticks of snapshots so a reciprocal-pair flag
  // doesn't blink out the instant the observation timestamp rolls past.
  // Latest-fire-per-pair wins; older fires fade via ageFrac → opacity below.
  const byPair = new Map<string, Hit>();
  for (const snap of recentSnapshots) {
    const buckets = new Map<
      string,
      { obsAB?: Observation; obsBA?: Observation; A: string; B: string }
    >();
    for (const o of snap.observations) {
      if (o.observer_id === o.subject_id) continue;
      const A = o.observer_id < o.subject_id ? o.observer_id : o.subject_id;
      const B = o.observer_id < o.subject_id ? o.subject_id : o.observer_id;
      const key = `${A}|${B}|${o.timestamp_ns.toString()}`;
      const entry = buckets.get(key) ?? { A, B };
      if (o.observer_id === A) entry.obsAB = o;
      else entry.obsBA = o;
      buckets.set(key, entry);
    }
    for (const { obsAB, obsBA, A, B } of buckets.values()) {
      if (!obsAB || !obsBA) continue;
      const delta = Math.abs(obsAB.range_m - obsBA.range_m);
      if (delta <= TIER1_THRESHOLD_M) continue;
      const aAg = agentById.get(A);
      const bAg = agentById.get(B);
      if (!aAg || !bAg) continue;
      const pk = `${A}|${B}`;
      const prev = byPair.get(pk);
      if (!prev || snap.tick > prev.lastTick) {
        byPair.set(pk, {
          key: pk,
          a: aAg,
          b: bAg,
          rangeAB: obsAB.range_m,
          rangeBA: obsBA.range_m,
          delta,
          lastTick: snap.tick,
        });
      }
    }
  }
  if (byPair.size === 0) return null;
  return (
    <g>
      {[...byPair.values()].map((p) => {
        const mx = (p.a.x + p.b.x) / 2;
        const my = (p.a.y + p.b.y) / 2;
        const dx = p.b.x - p.a.x;
        const dy = p.b.y - p.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        // Age fades the glyph linearly across LIFESPAN ticks; fresh = 1.
        const ageTicks = Math.max(0, currentTick - p.lastTick);
        const ageFrac = Math.min(1, ageTicks / RECIPROCITY_GLYPH_LIFESPAN);
        const freshness = 1 - ageFrac;
        const lobe = 1.6 + 0.4 * freshness; // 1.6 (faded) → 2.0 (fresh)
        const cap = 0.6;
        const cAx1 = mx - (dx / len) * cap;
        const cAy1 = my - (dy / len) * cap;
        const cBx1 = mx + (dx / len) * cap;
        const cBy1 = my + (dy / len) * cap;
        const stroke = 0.22 + 0.16 * freshness; // 0.22 → 0.38
        const glow = 0.55 + 0.35 * freshness;
        const baseOpacity = 0.95 * (0.35 + 0.65 * freshness); // 0.33 floor → 0.95 fresh
        return (
          <g key={p.key} style={{ cursor: "help" }}>
            {/* Soft glow halo behind the chevrons — makes the flag readable
                against busy observation traffic without overwhelming it. */}
            <circle
              cx={mx}
              cy={my}
              r={lobe * 1.8}
              fill="var(--status-flagged)"
              fillOpacity={0.06 * freshness}
            />
            <path
              d={`M ${cAx1 - nx * lobe} ${cAy1 - ny * lobe} L ${mx} ${my} L ${cAx1 + nx * lobe} ${cAy1 + ny * lobe}`}
              stroke="var(--status-flagged)"
              strokeWidth={stroke * 1.9}
              fill="none"
              strokeLinejoin="round"
              strokeOpacity={glow * 0.25}
            />
            <path
              d={`M ${cAx1 - nx * lobe} ${cAy1 - ny * lobe} L ${mx} ${my} L ${cAx1 + nx * lobe} ${cAy1 + ny * lobe}`}
              stroke="var(--status-flagged)"
              strokeWidth={stroke}
              fill="none"
              strokeLinejoin="round"
              strokeOpacity={baseOpacity}
            />
            <path
              d={`M ${cBx1 - nx * lobe} ${cBy1 - ny * lobe} L ${mx} ${my} L ${cBx1 + nx * lobe} ${cBy1 + ny * lobe}`}
              stroke="var(--status-flagged)"
              strokeWidth={stroke * 1.9}
              fill="none"
              strokeLinejoin="round"
              strokeOpacity={glow * 0.25}
            />
            <path
              d={`M ${cBx1 - nx * lobe} ${cBy1 - ny * lobe} L ${mx} ${my} L ${cBx1 + nx * lobe} ${cBy1 + ny * lobe}`}
              stroke="var(--status-flagged)"
              strokeWidth={stroke}
              fill="none"
              strokeLinejoin="round"
              strokeOpacity={baseOpacity}
            />
            <circle
              cx={mx}
              cy={my}
              r={lobe * 1.6}
              fill="transparent"
              onPointerEnter={() =>
                setHint(reciprocityGlyphHint(p.a, p.b, p.rangeAB, p.rangeBA, TIER1_THRESHOLD_M))
              }
              onPointerLeave={() => setHint(null)}
            />
          </g>
        );
      })}
    </g>
  );
});

const COHORT_PULSE_MS = 600;
const COHORT_RAY_LEN_MAX = 6.5;

const CohortPulses = memo(function CohortPulses({
  tick,
  events,
  agentById,
  setHint,
  hoveredOverlayKey,
  onOverlayHover,
}: {
  tick: number;
  events: ReadonlyArray<CohortEvent>;
  agentById: Map<string, Agent>;
  setHint: SetHint;
  hoveredOverlayKey: string | null;
  onOverlayHover: (key: string | null) => void;
}) {
  if (events.length === 0) return null;
  // Use a stable tick-based key so React re-mounts the <animate> tags exactly
  // on the tick the cohort closed (no animation re-trigger on hovers/re-renders).
  return (
    <g key={`cohort-${tick}`}>
      {events.map((ev, i) => {
        if (!ev.fired) return null;
        const subject = agentById.get(ev.subject_id);
        if (!subject) return null;
        const outliers = new Set(ev.outlier_observer_ids);
        const claims = ev.claims;
        if (claims.length === 0) return null;
        const ranges = claims.map((c) => c.range_m);
        const minR = Math.min(...ranges);
        const maxR = Math.max(...ranges);
        const span = Math.max(0.001, maxR - minR);
        const median = ev.median_range_m ?? minR;
        const angleStep = (Math.PI * 2) / claims.length;
        const isT2 = ev.tier_used === "t2";
        const cohortKey = `cohort:${tick}:${i}:${ev.subject_id}`;
        const lit = hoveredOverlayKey === cohortKey;
        return (
          <g key={`cohort-${tick}-${i}-${ev.subject_id}-${ev.timestamp_ns.toString()}`}>
            {claims.map((c, k) => {
              const angle = k * angleStep - Math.PI / 2;
              const observer = agentById.get(c.observer_id);
              if (!observer) return null;
              // Ray length encodes the deviation of this observer's claim
              // from the median, in units relative to the cohort span.
              const dev = Math.abs(c.range_m - median);
              const rayLen = Math.min(
                COHORT_RAY_LEN_MAX,
                1.5 + (dev / span) * (COHORT_RAY_LEN_MAX - 1.5),
              );
              const x2 = subject.x + Math.cos(angle) * rayLen;
              const y2 = subject.y + Math.sin(angle) * rayLen;
              const isOutlier = outliers.has(c.observer_id);
              const stroke = isOutlier
                ? "var(--status-byzantine)"
                : c.range_m === median
                  ? "var(--surface-1)"
                  : "var(--accent-primary)";
              return (
                <g key={`ray-${c.observer_id}`}>
                  <line
                    x1={subject.x}
                    y1={subject.y}
                    x2={x2}
                    y2={y2}
                    stroke={stroke}
                    strokeWidth={isOutlier ? 0.3 : 0.22}
                    strokeLinecap="round"
                    opacity={0}
                  >
                    <animate
                      attributeName="opacity"
                      values="0;0.9;0.85;0"
                      keyTimes="0;0.2;0.7;1"
                      dur={`${COHORT_PULSE_MS}ms`}
                      begin="0s"
                      repeatCount="1"
                      fill="freeze"
                    />
                  </line>
                  <text
                    x={x2 + Math.cos(angle) * 0.5}
                    y={y2 + Math.sin(angle) * 0.5}
                    fontSize={REP_FONT * 0.8}
                    fill={stroke}
                    textAnchor={Math.cos(angle) > 0.3 ? "start" : Math.cos(angle) < -0.3 ? "end" : "middle"}
                    opacity={0}
                  >
                    {c.observer_id}
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      keyTimes="0;0.2;0.7;1"
                      dur={`${COHORT_PULSE_MS}ms`}
                      begin="0s"
                      repeatCount="1"
                      fill="freeze"
                    />
                  </text>
                </g>
              );
            })}
            <circle
              cx={subject.x}
              cy={subject.y}
              r={COHORT_RAY_LEN_MAX + 0.6}
              fill="transparent"
              stroke={isT2 ? "var(--accent-warn)" : "var(--accent-primary)"}
              strokeWidth={0.12}
              strokeDasharray="0.6 0.4"
              opacity={0}
              pointerEvents="none"
            >
              <animate
                attributeName="opacity"
                values="0;0.6;0.22"
                keyTimes="0;0.3;1"
                dur={`${COHORT_PULSE_MS}ms`}
                begin="0s"
                repeatCount="1"
                fill="freeze"
              />
              <animate
                attributeName="r"
                from={(COHORT_RAY_LEN_MAX + 0.6).toString()}
                to={(COHORT_RAY_LEN_MAX + 1.4).toString()}
                dur={`${COHORT_PULSE_MS}ms`}
                begin="0s"
                repeatCount="1"
                fill="freeze"
              />
            </circle>
            <circle
              cx={subject.x}
              cy={subject.y}
              r={COHORT_RAY_LEN_MAX + 2.0}
              fill="transparent"
              style={{ cursor: "help", pointerEvents: "all" }}
              onPointerEnter={() => {
                onOverlayHover(cohortKey);
                setHint(
                  cohortPulseHint(
                    ev.subject_id,
                    ev.tier_used,
                    ev.observer_count,
                    ev.median_range_m,
                    ev.embeddability_score,
                    ev.outlier_observer_ids,
                  ),
                );
              }}
              onPointerLeave={() => {
                onOverlayHover(null);
                setHint(null);
              }}
            />
            {lit ? (
              <g pointerEvents="none">
                {claims.map((c, k) => {
                  const angle = k * angleStep - Math.PI / 2;
                  const observer = agentById.get(c.observer_id);
                  if (!observer) return null;
                  const dev = Math.abs(c.range_m - median);
                  const rayLen = Math.min(
                    COHORT_RAY_LEN_MAX,
                    1.5 + (dev / span) * (COHORT_RAY_LEN_MAX - 1.5),
                  );
                  const x2 = subject.x + Math.cos(angle) * rayLen;
                  const y2 = subject.y + Math.sin(angle) * rayLen;
                  const isOutlier = outliers.has(c.observer_id);
                  const stroke = isOutlier
                    ? "var(--status-byzantine)"
                    : c.range_m === median
                      ? "var(--surface-1)"
                      : "var(--accent-primary)";
                  return (
                    <g key={`lit-ray-${c.observer_id}`}>
                      <line
                        x1={subject.x}
                        y1={subject.y}
                        x2={x2}
                        y2={y2}
                        stroke={stroke}
                        strokeWidth={isOutlier ? 0.55 : 0.4}
                        strokeOpacity={1.0}
                        strokeLinecap="round"
                      />
                      <text
                        x={x2 + Math.cos(angle) * 0.5}
                        y={y2 + Math.sin(angle) * 0.5}
                        fontSize={REP_FONT * 0.9}
                        fill={stroke}
                        textAnchor={Math.cos(angle) > 0.3 ? "start" : Math.cos(angle) < -0.3 ? "end" : "middle"}
                        fontWeight={700}
                      >
                        {c.observer_id}
                      </text>
                    </g>
                  );
                })}
                <circle
                  cx={subject.x}
                  cy={subject.y}
                  r={COHORT_RAY_LEN_MAX + 0.6}
                  fill="transparent"
                  stroke={isT2 ? "var(--accent-warn)" : "var(--accent-primary)"}
                  strokeWidth={0.28}
                  strokeDasharray="0.6 0.4"
                  opacity={0.95}
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
});

const IGNITION_PULSE_MS = 850;

const AttackIgnition = memo(function AttackIgnition({
  snapshot,
  agents,
  byzantineIds,
}: {
  snapshot: TickSnapshot | null;
  agents: ReadonlyArray<Agent>;
  byzantineIds: Set<string>;
}) {
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  if (!snapshot || !snapshot.attackArmed) return null;
  if (snapshot.tick !== attackStartTick) return null;
  // Mark every attacker glyph at the canonical ignition tick. In the worker
  // path we don't know exactly who the attackers are at the canvas layer
  // (the stub spec hides them), so we fall back to byzantineIds when present
  // and otherwise pulse all phantoms + currently-flagged agents.
  const ignitionTargets = agents.filter(
    (a) => byzantineIds.has(a.id) || a.phantom === true,
  );
  if (ignitionTargets.length === 0) return null;
  return (
    <g key={`ignition-${snapshot.tick}`}>
      {ignitionTargets.map((a) => (
        <g key={`ign-${a.id}`}>
          <circle cx={a.x} cy={a.y} r={DRONE_R} fill="none" stroke="var(--accent-warn)" strokeWidth={0.3}>
            <animate
              attributeName="r"
              from={DRONE_R.toString()}
              to={(DRONE_R * 4.5).toString()}
              dur={`${IGNITION_PULSE_MS}ms`}
              begin="0s"
              repeatCount="1"
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              values="0.85;0.4;0"
              keyTimes="0;0.4;1"
              dur={`${IGNITION_PULSE_MS}ms`}
              begin="0s"
              repeatCount="1"
              fill="freeze"
            />
          </circle>
          <circle cx={a.x} cy={a.y} r={DRONE_R} fill="none" stroke="var(--status-byzantine)" strokeWidth={0.18}>
            <animate
              attributeName="r"
              from={DRONE_R.toString()}
              to={(DRONE_R * 3.0).toString()}
              dur={`${IGNITION_PULSE_MS}ms`}
              begin="0s"
              repeatCount="1"
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              values="1;0.5;0"
              keyTimes="0;0.5;1"
              dur={`${IGNITION_PULSE_MS}ms`}
              begin="0s"
              repeatCount="1"
              fill="freeze"
            />
          </circle>
        </g>
      ))}
    </g>
  );
});

const PresenceOverlay = memo(function PresenceOverlay({
  snapshot,
  agentById,
  hoveredId,
  setHint,
}: {
  snapshot: TickSnapshot | null;
  agentById: Map<string, Agent>;
  hoveredId: string | null;
  setHint: SetHint;
}) {
  if (!snapshot) return null;
  const tickNs = BigInt(Math.round(snapshot.t * 1_000_000_000));
  const phantomIds = new Set<string>();
  for (const a of snapshot.agents) if (a.phantom) phantomIds.add(a.id);

  // For each subject the snapshot tracks, decide presence:
  //   has real-agent observer with age < PRESENCE_WINDOW_NS → has presence.
  type Granter = { observerId: string; ageS: number; phantom: boolean };
  const granters = new Map<string, Granter[]>();
  const hasRealPresence = new Map<string, boolean>();
  for (const [subjectId, inner] of Object.entries(snapshot.presenceGraph ?? {})) {
    if (subjectId === "") continue;
    const list: Granter[] = [];
    let real = false;
    for (const [observerId, ts] of Object.entries(inner)) {
      const observerTs = ts as bigint;
      const ageNs = tickNs - observerTs;
      if (ageNs < 0n || ageNs >= PRESENCE_WINDOW_NS) continue;
      const isPhantom = phantomIds.has(observerId);
      if (!isPhantom && observerId !== subjectId) real = true;
      list.push({
        observerId,
        ageS: Number(ageNs) / 1_000_000_000,
        phantom: isPhantom,
      });
    }
    granters.set(subjectId, list);
    hasRealPresence.set(subjectId, real);
  }

  // Halos: render around any subject that lacks real-agent presence — only
  // relevant when a scenario has phantoms. For "all real, all granted"
  // scenarios this overlay is silent.
  const halos: Array<{ a: Agent; phantom: boolean }> = [];
  for (const a of snapshot.agents) {
    if (a.id === undefined) continue;
    if (hasRealPresence.get(a.id) === false || (a.phantom && !hasRealPresence.get(a.id))) {
      halos.push({ a, phantom: a.phantom === true });
    }
  }

  // Arrows: only show for the hovered subject — keeps the canvas clean when
  // not actively investigating.
  const focusId = hoveredId;
  const focused = focusId ? agentById.get(focusId) : undefined;
  const focusGranters = focusId ? (granters.get(focusId) ?? []) : [];

  return (
    <g>
      {halos.map(({ a, phantom }) => (
        <g key={`halo-${a.id}`} style={{ cursor: "help" }}>
          <circle
            cx={a.x}
            cy={a.y}
            r={DRONE_R * 2.6}
            fill="none"
            stroke="var(--status-byzantine)"
            strokeWidth={STROKE_THIN}
            strokeDasharray="0.4 0.4"
            strokeOpacity={0.85}
          />
          <circle
            cx={a.x}
            cy={a.y}
            r={DRONE_R * 2.6}
            fill="transparent"
            onPointerEnter={() => setHint(presenceHaloHint(a.id, phantom))}
            onPointerLeave={() => setHint(null)}
          />
        </g>
      ))}
      {focused && focusGranters.length > 0
        ? focusGranters.map((g) => {
            const observer = agentById.get(g.observerId);
            if (!observer || observer.id === focused.id) return null;
            const ageRatio = Math.max(0, Math.min(1, g.ageS / 2.0));
            const opacity = (1 - ageRatio) * 0.75 + 0.1;
            const stroke = g.phantom ? "var(--status-byzantine)" : "var(--accent-primary)";
            return (
              <g key={`pres-${g.observerId}->${focused.id}`} style={{ cursor: "help" }}>
                <line
                  x1={observer.x}
                  y1={observer.y}
                  x2={focused.x}
                  y2={focused.y}
                  stroke={stroke}
                  strokeWidth={0.15}
                  strokeOpacity={opacity}
                  strokeDasharray="0.3 0.5"
                />
                <line
                  x1={observer.x}
                  y1={observer.y}
                  x2={focused.x}
                  y2={focused.y}
                  stroke="transparent"
                  strokeWidth={1.4}
                  onPointerEnter={() =>
                    setHint(presenceArrowHint(g.observerId, focused.id, g.ageS, g.phantom))
                  }
                  onPointerLeave={() => setHint(null)}
                />
              </g>
            );
          })
        : null}
    </g>
  );
});

const Rejections = memo(function Rejections({
  rejections,
  agentById,
  snapshotByTick,
  setHint,
  hoveredEdgeKey,
  selectedEdgeKey,
  onEdgeHover,
}: {
  rejections: ReadonlyArray<RejectionEvent>;
  agentById: Map<string, Agent>;
  snapshotByTick: ReadonlyMap<number, TickSnapshot>;
  setHint: SetHint;
  hoveredEdgeKey: string | null;
  selectedEdgeKey: string | null;
  onEdgeHover: (key: string | null) => void;
}) {
  if (rejections.length === 0) return null;
  return (
    <g>
      {rejections.map((r) => {
        const stableId = `${r.tick}:${r.fromId}->${r.toId}:${r.reason}`;
        const edgeKey = `rej:${stableId}`;
        return (
          <RejectionMarker
            key={edgeKey}
            edgeKey={edgeKey}
            rejection={r}
            agentById={agentById}
            snapshotByTick={snapshotByTick}
            setHint={setHint}
            lit={hoveredEdgeKey === edgeKey || selectedEdgeKey === edgeKey}
            onEdgeHover={onEdgeHover}
          />
        );
      })}
    </g>
  );
});

const GhostRejections = memo(function GhostRejections({
  ghosts,
  agentById,
  snapshotByTick,
  setHint,
  hoveredEdgeKey,
  selectedEdgeKey,
  onEdgeHover,
}: {
  ghosts: ReadonlyArray<{ ev: RejectionEvent; ageFrac: number }>;
  agentById: Map<string, Agent>;
  snapshotByTick: ReadonlyMap<number, TickSnapshot>;
  setHint: SetHint;
  hoveredEdgeKey: string | null;
  selectedEdgeKey: string | null;
  onEdgeHover: (key: string | null) => void;
}) {
  if (ghosts.length === 0) return null;
  return (
    <g>
      {ghosts.map(({ ev: r, ageFrac }) => {
        const stableId = `${r.tick}:${r.fromId}->${r.toId}:${r.reason}`;
        const edgeKey = `rej-ghost:${stableId}`;
        return (
          <RejectionMarker
            key={edgeKey}
            edgeKey={edgeKey}
            rejection={r}
            agentById={agentById}
            snapshotByTick={snapshotByTick}
            setHint={setHint}
            lit={hoveredEdgeKey === edgeKey || selectedEdgeKey === edgeKey}
            onEdgeHover={onEdgeHover}
            ghost
            ageFrac={ageFrac}
          />
        );
      })}
    </g>
  );
});

function RejectionMarker({
  edgeKey,
  rejection,
  agentById,
  snapshotByTick,
  setHint,
  lit,
  onEdgeHover,
  ghost = false,
  ageFrac = 0,
}: {
  edgeKey: string;
  rejection: RejectionEvent;
  agentById: Map<string, Agent>;
  snapshotByTick: ReadonlyMap<number, TickSnapshot>;
  setHint: SetHint;
  lit: boolean;
  onEdgeHover: (key: string | null) => void;
  ghost?: boolean;
  /** 0 = just printed, 1 = at end of lifespan. Drives ghost opacity fade. */
  ageFrac?: number;
}) {
  // Freeze both endpoints to where they were at the rejection's tick — that's
  // what makes a ghost a "print" instead of an X dragging behind a moving
  // receiver. Falls back to the current-tick agent position if the snapshot
  // for that tick isn't available (e.g. the active marker before snapshots
  // are loaded), which preserves the original live-marker behavior.
  const frozen = snapshotByTick.get(rejection.tick);
  const frozenFrom = frozen?.agents.find((a) => a.id === rejection.fromId);
  const frozenTo = frozen?.agents.find((a) => a.id === rejection.toId);
  const to = frozenTo ?? agentById.get(rejection.toId);
  if (!to) return null;
  const fromX = rejection.fromX ?? frozenFrom?.x ?? agentById.get(rejection.fromId)?.x;
  const fromY = rejection.fromY ?? frozenFrom?.y ?? agentById.get(rejection.fromId)?.y;
  if (fromX === undefined || fromY === undefined) return null;
  const toX = to.x;
  const toY = to.y;
  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2;
  const tag = rejection.reason === "signature" ? "✗ SIG INVALID" : "✗ REPLAY DROPPED";
  // Ghost = pedagogical artifact for a rejection that happened on an earlier
  // tick. Same geometry, muted color, suppressed body label, lower opacity.
  // Hover or click lights it back up so the learner can still read the detail.
  const stroke = ghost ? "var(--text-low)" : "var(--status-byzantine)";
  const fade = ghost && !lit ? 1 - ageFrac : 1;
  const baseOpacity = (ghost ? 0.45 : 0.85) * fade;
  const xMarkOpacity = (ghost ? 0.72 : 0.95) * fade;
  const tagOpacity = (ghost ? 0.55 : 0.95) * fade;
  const xMarkExtent = ghost ? 2.0 : 1.5;
  return (
    <g
      data-edge-key={edgeKey}
      style={{ cursor: "pointer" }}
      onPointerEnter={() => {
        onEdgeHover(edgeKey);
        setHint(rejectionHint(rejection));
      }}
      onPointerLeave={() => {
        onEdgeHover(null);
        setHint(null);
      }}
    >
      {lit ? (
        <line
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
          stroke="var(--status-byzantine)"
          strokeWidth={1.2}
          strokeOpacity={0.25}
        />
      ) : null}
      <line
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke={lit ? "var(--status-byzantine)" : stroke}
        strokeWidth={lit ? 0.55 : ghost ? 0.22 : 0.3}
        strokeOpacity={lit ? 1.0 : baseOpacity}
        strokeDasharray="1.2 0.8"
      />
      <line
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke="transparent"
        strokeWidth={2.0}
      />
      <line
        x1={mx - xMarkExtent}
        y1={my - xMarkExtent}
        x2={mx + xMarkExtent}
        y2={my + xMarkExtent}
        stroke={lit ? "var(--status-byzantine)" : stroke}
        strokeWidth={ghost ? 0.45 : 0.5}
        strokeOpacity={lit ? 1.0 : xMarkOpacity}
        strokeLinecap="round"
      />
      <line
        x1={mx + xMarkExtent}
        y1={my - xMarkExtent}
        x2={mx - xMarkExtent}
        y2={my + xMarkExtent}
        stroke={lit ? "var(--status-byzantine)" : stroke}
        strokeWidth={ghost ? 0.45 : 0.5}
        strokeOpacity={lit ? 1.0 : xMarkOpacity}
        strokeLinecap="round"
      />
      {ghost && !lit ? (
        <circle
          cx={mx}
          cy={my}
          r={0.35}
          fill={stroke}
          fillOpacity={0.55 * fade}
        />
      ) : null}
      {ghost && !lit ? null : (
        <>
          <text
            x={mx}
            y={my - 2.8}
            fontSize={1.3}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill={lit ? "var(--status-byzantine)" : stroke}
            opacity={tagOpacity}
            letterSpacing={0.5}
          >
            {tag}
          </text>
          <text
            x={mx}
            y={my + 3.4}
            fontSize={1.1}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill="var(--text-mid)"
            opacity={0.9}
          >
            {rejection.fromId} → {rejection.toId} · {rejection.detail}
          </text>
        </>
      )}
    </g>
  );
}

const Phantoms = memo(function Phantoms({
  phantoms,
  mapAttacks,
  reps,
  onHover,
  setHint,
}: {
  phantoms: ReadonlyArray<CopEntry>;
  mapAttacks: ReadonlyArray<MapAttack>;
  reps: Record<string, number>;
  onHover: (id: string | null) => void;
  setHint: SetHint;
}) {
  if (mapAttacks.length === 0 || phantoms.length === 0) return null;
  const labelByContact = new Map<string, string>();
  for (const m of mapAttacks) {
    for (const p of m.phantomContacts) labelByContact.set(p.id, p.label);
  }
  return (
    <g>
      {phantoms.map((p) => {
        const label = labelByContact.get(p.contactId) ?? p.contactId;
        const reporter = p.reporters[0] ?? "?";
        return (
          <PhantomMarker
            key={p.contactId}
            contactId={p.contactId}
            x={p.x}
            y={p.y}
            label={label}
            reporter={reporter}
            surviving={p.surviving}
            trustWeight={p.trustWeight}
            onHover={onHover}
            onHoverEnter={() => setHint(phantomHint(p, mapAttacks, reps))}
            onHoverLeave={() => setHint(null)}
          />
        );
      })}
    </g>
  );
});

const ExternalEmitters = memo(function ExternalEmitters({
  emitters,
  setHint,
}: {
  emitters: ReadonlyArray<{ id: string; x: number; y: number }>;
  setHint: SetHint;
}) {
  if (emitters.length === 0) return null;
  return (
    <g>
      {emitters.map((e) => (
        <g
          key={`emit-${e.id}`}
          style={{ cursor: "help" }}
          onPointerEnter={() => setHint(externalEmitterHint(e.id))}
          onPointerLeave={() => setHint(null)}
        >
          {/* Soft hostile halo */}
          <circle
            cx={e.x}
            cy={e.y}
            r={2.4}
            fill="var(--status-byzantine)"
            fillOpacity={0.08}
          />
          <circle
            cx={e.x}
            cy={e.y}
            r={1.6}
            fill="none"
            stroke="var(--status-byzantine)"
            strokeWidth={0.18}
            strokeDasharray="0.6 0.4"
            strokeOpacity={0.9}
          />
          {/* Warning triangle */}
          <polygon
            points={`${e.x},${e.y - 1.0} ${e.x + 0.95},${e.y + 0.65} ${e.x - 0.95},${e.y + 0.65}`}
            fill="var(--status-byzantine)"
            fillOpacity={0.85}
            stroke="var(--status-byzantine)"
            strokeWidth={0.12}
          />
          <text
            x={e.x}
            y={e.y + 0.45}
            fontSize={0.85}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill="var(--surface-bg)"
            fontWeight={700}
          >
            !
          </text>
          {/* ID label */}
          <text
            x={e.x}
            y={e.y - 2.0}
            fontSize={1.3}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill="var(--status-byzantine)"
            fontWeight={700}
            letterSpacing={0.5}
          >
            {e.id}
          </text>
          <text
            x={e.x}
            y={e.y + 3.4}
            fontSize={1.0}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill="var(--text-mid)"
            opacity={0.85}
            letterSpacing={0.4}
          >
            off-roster
          </text>
        </g>
      ))}
    </g>
  );
});

function PhantomMarker({
  contactId,
  x,
  y,
  label,
  reporter,
  surviving,
  trustWeight,
  onHover,
  onHoverEnter,
  onHoverLeave,
}: {
  contactId: string;
  x: number;
  y: number;
  label: string;
  reporter: string;
  surviving: boolean;
  trustWeight: number;
  onHover: (id: string | null) => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
}) {
  const fillOpacity = surviving ? 0.28 : 0.05;
  const stroke = surviving ? "var(--status-byzantine)" : "var(--text-low)";
  const strokeOpacity = surviving ? 0.95 : 0.45;
  const dash = surviving ? undefined : "0.5 0.4";
  const labelColor = surviving ? "var(--status-byzantine)" : "var(--text-low)";
  return (
    <g
      onPointerEnter={() => {
        onHover(contactId);
        onHoverEnter();
      }}
      onPointerLeave={() => {
        onHover(null);
        onHoverLeave();
      }}
      style={{ cursor: "help" }}
    >
      <circle cx={x} cy={y} r={3} fill="transparent" />
      <polygon
        points={`${x},${y - 1.4} ${x + 1.3},${y + 1.0} ${x - 1.3},${y + 1.0}`}
        fill="var(--status-byzantine)"
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={0.22}
        strokeDasharray={dash}
      />
      <text
        x={x}
        y={y + 2.6}
        fontSize={1.2}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill={labelColor}
        opacity={surviving ? 0.95 : 0.55}
        letterSpacing={0.5}
      >
        {label}
      </text>
      <text
        x={x}
        y={y + 4.0}
        fontSize={1.1}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill={surviving ? "var(--text-mid)" : "var(--status-nominal)"}
        opacity={0.85}
      >
        {surviving
          ? `REPORTED BY ${reporter} · w=${trustWeight.toFixed(2)}`
          : `✗ FILTERED · w=${trustWeight.toFixed(2)} < 0.50`}
      </text>
    </g>
  );
}

function PhantomDetailCard({
  phantomId,
  phantoms,
  mapAttacks,
  witnessMap,
  reps,
  agents,
}: {
  phantomId: string | null;
  phantoms: ReadonlyArray<CopEntry>;
  mapAttacks: ReadonlyArray<MapAttack>;
  witnessMap: PhantomWitnessMap;
  reps: Record<string, number>;
  agents: ReadonlyArray<Agent>;
}) {
  if (!phantomId) return null;
  const entry = phantoms.find((p) => p.contactId === phantomId);
  if (!entry) return null;
  let label = entry.contactId;
  for (const m of mapAttacks) {
    const found = m.phantomContacts.find((c) => c.id === phantomId);
    if (found) {
      label = found.label;
      break;
    }
  }
  const reporters = entry.reporters;
  const reporterSet = new Set(reporters);
  const witnesses = witnessMap[phantomId] ?? [];
  const realAgentIds = new Set(agents.filter((a) => !a.phantom).map((a) => a.id));
  const disputers = witnesses.filter((id) => !reporterSet.has(id) && realAgentIds.has(id));
  const confidencePct = Math.min(200, (entry.trustWeight / COP_TRUST_THRESHOLD) * 100);
  const statusColor = entry.surviving ? "var(--status-byzantine)" : "var(--status-nominal)";
  const statusText = entry.surviving
    ? `✗ SURVIVING · IN COP`
    : `✓ FILTERED · BELOW THRESHOLD`;
  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        padding: "10px 12px",
        background: "rgba(11, 13, 16, 0.94)",
        border: "1px solid var(--status-byzantine)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-mid)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 260,
        maxWidth: 320,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--status-byzantine)", letterSpacing: 1 }}>FABRICATED CONTACT</span>
        <span style={{ color: "var(--text-low)", fontSize: 11.5 }}>
          ({entry.x.toFixed(1)}, {entry.y.toFixed(1)})
        </span>
      </div>
      <span style={{ color: "var(--text-hi)", fontSize: 12 }}>{label}</span>
      <span style={{ color: statusColor, fontSize: 11.5, letterSpacing: 0.8 }}>{statusText}</span>
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <ConfidenceBar pct={confidencePct} weight={entry.trustWeight} />
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <PhantomPeerList
        label="REPORTED BY"
        peers={reporters.map((id) => ({ id, rep: reps[id] ?? 0.5 }))}
        emptyMessage="(none)"
        accent="var(--status-byzantine)"
      />
      <PhantomPeerList
        label="DISPUTED BY"
        peers={disputers.map((id) => ({ id, rep: reps[id] ?? 0.5 }))}
        emptyMessage="(no honest drone has flown over yet)"
        accent="var(--status-nominal)"
        suffix="silent on this cell"
      />
    </div>
  );
}

function ConfidenceBar({ pct, weight }: { pct: number; weight: number }) {
  const clamped = Math.max(0, Math.min(200, pct));
  const above = clamped >= 100;
  const fillColor = above ? "var(--status-byzantine)" : "var(--status-nominal)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-low)" }}>
        <span>CONFIDENCE · w={weight.toFixed(2)}</span>
        <span style={{ color: fillColor }}>{clamped.toFixed(0)}%</span>
      </div>
      <div
        style={{
          position: "relative",
          height: 6,
          background: "var(--border-subtle)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${clamped / 2}%`,
            background: fillColor,
            transition: "width 80ms linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 1,
            height: "100%",
            background: "var(--text-mid)",
            opacity: 0.6,
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: "var(--text-low)" }}>
        100% = COP threshold (w = {COP_TRUST_THRESHOLD.toFixed(2)})
      </span>
    </div>
  );
}

function PhantomPeerList({
  label,
  peers,
  emptyMessage,
  accent,
  suffix,
}: {
  label: string;
  peers: ReadonlyArray<{ id: string; rep: number }>;
  emptyMessage: string;
  accent: string;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11.5, color: "var(--text-low)", letterSpacing: 1 }}>
        {label} · {peers.length}
      </span>
      {peers.length === 0 ? (
        <span style={{ fontSize: 11.5, color: "var(--text-low)" }}>{emptyMessage}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {peers.map((p) => (
            <div
              key={p.id}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}
            >
              <span style={{ color: accent }}>{p.id}</span>
              <span style={{ color: "var(--text-mid)" }}>
                rep {p.rep.toFixed(2)}
                {suffix ? ` · ${suffix}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Fog = memo(function Fog({ grid, currentTick }: { grid: CoverageGrid | undefined; currentTick: number }) {
  if (!grid) return null;
  const rects: JSX.Element[] = [];
  const size = grid.cellSize;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (isCovered(grid, col, row, currentTick)) continue;
      const x = grid.originX + col * size;
      const y = grid.originY + row * size;
      rects.push(
        <rect
          key={row * grid.cols + col}
          x={x}
          y={y}
          width={size}
          height={size}
          fill="var(--surface-1)"
          fillOpacity={0.88}
        />,
      );
    }
  }
  return <g>{rects}</g>;
});

const SectorGrid = memo(function SectorGrid({ setHint }: { setHint: SetHint }) {
  const { minX, maxX, minY, maxY } = AO_WORLD.bounds;
  const step = AO_WORLD.sectorSize;
  const lines: JSX.Element[] = [];
  for (let x = minX; x <= maxX; x += step) {
    lines.push(
      <line key={`gx-${x}`} x1={x} y1={minY} x2={x} y2={maxY}
        stroke="var(--border-subtle)" strokeWidth={0.08} strokeOpacity={0.5} />,
    );
  }
  for (let y = minY; y <= maxY; y += step) {
    lines.push(
      <line key={`gy-${y}`} x1={minX} y1={y} x2={maxX} y2={y}
        stroke="var(--border-subtle)" strokeWidth={0.08} strokeOpacity={0.5} />,
    );
  }
  const labels: JSX.Element[] = [];
  let col = 0;
  for (let x = minX; x < maxX; x += step) {
    let row = 0;
    for (let y = minY; y < maxY; y += step) {
      const code = `${String.fromCharCode(65 + col)}${row + 1}`;
      labels.push(
        <text
          key={`s-${col}-${row}`}
          x={x + 1}
          y={y + 2.4}
          fontSize={1.3}
          fontFamily="var(--font-mono)"
          fill="var(--text-low)"
          opacity={0.45}
          style={{ cursor: "help" }}
          onPointerEnter={() => setHint(sectorHint(code))}
          onPointerLeave={() => setHint(null)}
        >
          {code}
        </text>,
      );
      row++;
    }
    col++;
  }
  return <g>{lines}{labels}</g>;
});

const AOOutline = memo(function AOOutline({ setHint }: { setHint: SetHint }) {
  const { minX, minY, maxX, maxY } = AO_WORLD.bounds;
  return (
    <g>
      <rect
        x={minX}
        y={minY}
        width={maxX - minX}
        height={maxY - minY}
        fill="none"
        stroke="var(--accent-primary)"
        strokeOpacity={0.35}
        strokeWidth={0.25}
        strokeDasharray="1.5 1.5"
        style={{ cursor: "help" }}
        onPointerEnter={() => setHint(aoOutlineHint())}
        onPointerLeave={() => setHint(null)}
      />
      <text
        x={minX + 0.6}
        y={minY - 1.2}
        fontSize={1.4}
        fontFamily="var(--font-mono)"
        fill="var(--accent-primary)"
        opacity={0.7}
        letterSpacing={1}
      >
        AO · 100m × 100m
      </text>
    </g>
  );
});

function Items({
  items,
  detections,
  reps,
  setHint,
}: {
  items: ReadonlyArray<Item>;
  detections: Record<string, DetectionState>;
  reps: Record<string, number>;
  setHint: SetHint;
}) {
  return (
    <g>
      {items.map((item) => (
        <ItemMarker
          key={item.id}
          item={item}
          detection={detections[item.id]}
          reps={reps}
          setHint={setHint}
        />
      ))}
    </g>
  );
}

function ConfirmationBadge({
  x,
  y,
  detection,
}: {
  x: number;
  y: number;
  detection: DetectionState | undefined;
}) {
  const suppressedBy = detection?.suppressedBy ?? [];
  if (!detection || !detection.detected) {
    return (
      <g>
        <text
          x={x}
          y={y}
          fontSize={1.15}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--text-low)"
          opacity={0.7}
          letterSpacing={0.5}
        >
          UNMAPPED
        </text>
        {suppressedBy.length > 0 ? (
          <text
            x={x}
            y={y + 1.4}
            fontSize={1.1}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
            fill="var(--status-byzantine)"
            opacity={0.95}
            letterSpacing={0.5}
          >
            ✗ hidden by {suppressedBy.join(", ")}
          </text>
        ) : null}
      </g>
    );
  }
  const total = detection.trustedCount + detection.untrustedCount;
  const color =
    detection.untrustedCount > 0 && detection.trustedCount === 0
      ? "var(--status-byzantine)"
      : detection.untrustedCount > 0
        ? "var(--status-flagged)"
        : "var(--status-nominal)";
  const tag =
    detection.untrustedCount > 0 && detection.trustedCount === 0
      ? "✗"
      : detection.untrustedCount > 0
        ? "△"
        : "✓";
  return (
    <g>
      <text
        x={x}
        y={y}
        fontSize={1.15}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill={color}
        opacity={0.95}
        letterSpacing={0.5}
      >
        {`${tag} ${detection.trustedCount}/${total}`}
      </text>
      {suppressedBy.length > 0 ? (
        <text
          x={x}
          y={y + 1.4}
          fontSize={1.1}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--status-byzantine)"
          opacity={0.95}
          letterSpacing={0.5}
        >
          ✗ hidden by {suppressedBy.join(", ")}
        </text>
      ) : null}
    </g>
  );
}

function ItemMarker({
  item,
  detection,
  reps,
  setHint,
}: {
  item: Item;
  detection: DetectionState | undefined;
  reps: Record<string, number>;
  setHint: SetHint;
}) {
  const detected = detection?.detected ?? false;
  const undiscoveredOpacity = 0.22;
  const discoveredOpacity = 1.0;
  const op = detected ? discoveredOpacity : undiscoveredOpacity;
  const hoverProps = {
    style: { cursor: "help" } as const,
    onPointerEnter: () =>
      setHint(
        itemHint(
          item,
          detected,
          detection?.observers ?? [],
          detection?.trustedCount ?? 0,
          detection?.untrustedCount ?? 0,
          detection?.suppressedBy ?? [],
          reps,
        ),
      ),
    onPointerLeave: () => setHint(null),
  };
  if (item.kind === "building") {
    const fill =
      item.subtype === "industrial"
        ? "var(--surface-2)"
        : item.subtype === "residential"
          ? "var(--surface-2)"
          : "var(--surface-1)";
    const stroke =
      item.subtype === "outpost" ? "var(--text-low)" : "var(--text-mid)";
    const dash = !detected ? "0.8 0.6" : item.subtype === "outpost" ? "0.6 0.4" : undefined;
    const labelText = detected ? item.label : "??";
    const fit = fitLabel(labelText, item.w, item.h);
    return (
      <g opacity={op} {...hoverProps}>
        <rect
          x={item.x}
          y={item.y}
          width={item.w}
          height={item.h}
          fill={fill}
          fillOpacity={detected ? 0.6 : 0.15}
          stroke={stroke}
          strokeWidth={0.18}
          strokeDasharray={dash}
        />
        <text
          x={item.x + item.w / 2}
          y={item.y + item.h / 2 + fit.yOffset}
          fontSize={fit.fontSize}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--text-mid)"
          opacity={0.95}
          letterSpacing={0.4}
        >
          {fit.lines.map((line, i) => (
            <tspan
              key={i}
              x={item.x + item.w / 2}
              dy={i === 0 ? 0 : fit.lineHeight}
            >
              {line}
            </tspan>
          ))}
        </text>
        <ConfirmationBadge x={item.x + item.w / 2} y={item.y + item.h + 1.5} detection={detection} />
      </g>
    );
  }
  if (item.kind === "vehicle") {
    return (
      <g opacity={op} {...hoverProps}>
        <rect
          x={item.x - item.w / 2}
          y={item.y - item.h / 2}
          width={item.w}
          height={item.h}
          rx={0.4}
          fill="var(--text-mid)"
          fillOpacity={detected ? 0.7 : 0.2}
          stroke="var(--text-hi)"
          strokeWidth={0.1}
          strokeDasharray={detected ? undefined : "0.5 0.4"}
        />
        <text
          x={item.x}
          y={item.y - item.h / 2 - 0.6}
          fontSize={1.1}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--text-low)"
          opacity={0.85}
        >
          {detected ? item.label : "??"}
        </text>
        <ConfirmationBadge x={item.x} y={item.y + item.h / 2 + 1.3} detection={detection} />
      </g>
    );
  }
  if (item.kind === "uxo") {
    return (
      <g opacity={op} {...hoverProps}>
        <polygon
          points={`${item.x},${item.y - 1.2} ${item.x + 1.1},${item.y + 0.9} ${item.x - 1.1},${item.y + 0.9}`}
          fill="var(--status-byzantine)"
          fillOpacity={detected ? 0.3 : 0.08}
          stroke="var(--status-byzantine)"
          strokeWidth={0.18}
          strokeDasharray={detected ? undefined : "0.4 0.3"}
        />
        <text
          x={item.x}
          y={item.y + 2.4}
          fontSize={1.2}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--status-byzantine)"
          opacity={0.9}
          letterSpacing={0.5}
        >
          {detected ? item.label : "?? UXO"}
        </text>
        <ConfirmationBadge x={item.x} y={item.y + 3.8} detection={detection} />
      </g>
    );
  }
  return (
    <g opacity={op} {...hoverProps}>
      <rect
        x={item.x}
        y={item.y}
        width={item.w}
        height={item.h}
        fill="var(--status-nominal)"
        fillOpacity={0.15}
        stroke="var(--status-nominal)"
        strokeWidth={0.25}
      />
      <line
        x1={item.x + item.w / 2}
        y1={item.y + 2}
        x2={item.x + item.w / 2}
        y2={item.y + item.h - 2}
        stroke="var(--status-nominal)"
        strokeWidth={0.25}
        strokeOpacity={0.7}
      />
      <line
        x1={item.x + 2}
        y1={item.y + item.h / 2}
        x2={item.x + item.w - 2}
        y2={item.y + item.h / 2}
        stroke="var(--status-nominal)"
        strokeWidth={0.25}
        strokeOpacity={0.7}
      />
      <text
        x={item.x + item.w / 2}
        y={item.y - 0.6}
        fontSize={1.2}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill="var(--status-nominal)"
        opacity={0.95}
        letterSpacing={1}
      >
        {item.label}
      </text>
    </g>
  );
}

const SensorFootprints = memo(function SensorFootprints({
  agents,
  setHint,
  hoveredOverlayKey,
  onOverlayHover,
}: {
  agents: ReadonlyArray<Agent>;
  setHint: SetHint;
  hoveredOverlayKey: string | null;
  onOverlayHover: (key: string | null) => void;
}) {
  const r = AO_WORLD.sensorRadiusM;
  return (
    <g>
      {agents.map((a) => {
        const key = `sensor:${a.id}`;
        const lit = hoveredOverlayKey === key;
        return (
          <circle
            key={`sf-${a.id}`}
            cx={a.x}
            cy={a.y}
            r={r}
            fill="var(--accent-primary)"
            fillOpacity={lit ? 0.12 : 0.05}
            stroke="var(--accent-primary)"
            strokeOpacity={lit ? 0.85 : 0.25}
            strokeWidth={lit ? 0.28 : 0.12}
            strokeDasharray={SENSOR_DASH}
            style={{ cursor: "help", transition: "fill-opacity 140ms, stroke-opacity 140ms, stroke-width 140ms" }}
            onPointerEnter={() => {
              onOverlayHover(key);
              setHint(sensorFootprintHint(a));
            }}
            onPointerLeave={() => {
              onOverlayHover(null);
              setHint(null);
            }}
          />
        );
      })}
    </g>
  );
});

function ObservationLines({
  observations,
  agentById,
  byzantineIds,
  hoveredId,
  reps,
  setHint,
  hoveredEdgeKey,
  selectedEdgeKey,
  onEdgeHover,
}: {
  observations: ReadonlyArray<Observation>;
  agentById: Map<string, Agent>;
  byzantineIds: Set<string>;
  hoveredId: string | null;
  reps: Record<string, number>;
  setHint: SetHint;
  hoveredEdgeKey: string | null;
  selectedEdgeKey: string | null;
  onEdgeHover: (key: string | null) => void;
}) {
  const seen = new Set<string>();
  const groups: JSX.Element[] = [];
  for (const obs of observations) {
    const key = [obs.observer_id, obs.subject_id].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = agentById.get(obs.observer_id);
    const b = agentById.get(obs.subject_id);
    if (!a || !b) continue;
    const tainted = byzantineIds.has(obs.observer_id) || byzantineIds.has(obs.subject_id);
    const edgeKey = `obs:${key}`;
    const lit = hoveredEdgeKey === edgeKey || selectedEdgeKey === edgeKey;
    const dim = (hoveredId !== null || hoveredEdgeKey !== null || selectedEdgeKey !== null) && !lit;
    const baseOpacity = tainted ? 0.6 : 0.22;
    const observerRep = reps[obs.observer_id] ?? 1.0;
    const color = tainted ? "var(--status-byzantine)" : "var(--accent-primary)";
    groups.push(
      <g key={`obs-${key}`} data-edge-key={edgeKey} style={{ cursor: "pointer" }}>
        {lit ? (
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={color}
            strokeWidth={(tainted ? STROKE_THICK : STROKE_THIN) * 3.2}
            strokeOpacity={0.25}
          />
        ) : null}
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={color}
          strokeOpacity={lit ? 1.0 : dim ? baseOpacity * 0.25 : baseOpacity}
          strokeWidth={lit ? (tainted ? STROKE_THICK : STROKE_THIN) * 1.8 : tainted ? STROKE_THICK : STROKE_THIN}
          strokeDasharray={tainted ? undefined : lit ? undefined : DASH_OBS}
        />
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="transparent"
          strokeWidth={1.8}
          onPointerEnter={() => {
            onEdgeHover(edgeKey);
            setHint(observationHint(obs, a, b, tainted, observerRep));
          }}
          onPointerLeave={() => {
            onEdgeHover(null);
            setHint(null);
          }}
        />
      </g>,
    );
  }
  return <g>{groups}</g>;
}

function PerspectiveEdge({
  obs,
  agentById,
  setHint,
}: {
  obs: Observation;
  agentById: Map<string, Agent>;
  setHint: SetHint;
}) {
  const a = agentById.get(obs.observer_id);
  const b = agentById.get(obs.subject_id);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const tip = { x: b.x - ux * 1.6, y: b.y - uy * 1.6 };
  const headLen = 1.1;
  const headWid = 0.7;
  const headL = {
    x: tip.x - ux * headLen + -uy * headWid,
    y: tip.y - uy * headLen + ux * headWid,
  };
  const headR = {
    x: tip.x - ux * headLen - -uy * headWid,
    y: tip.y - uy * headLen - ux * headWid,
  };
  return (
    <g
      style={{ cursor: "help" }}
      onPointerEnter={() => setHint(observationHint(obs, a, b, false, 1.0))}
      onPointerLeave={() => setHint(null)}
    >
      <line
        x1={a.x}
        y1={a.y}
        x2={tip.x}
        y2={tip.y}
        stroke="var(--accent-primary)"
        strokeOpacity={0.95}
        strokeWidth={STROKE_THICK}
      />
      <polygon
        points={`${tip.x},${tip.y} ${headL.x},${headL.y} ${headR.x},${headR.y}`}
        fill="var(--accent-primary)"
        fillOpacity={0.95}
      />
      <text
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2 - 0.6}
        fontSize={1.35}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill="var(--accent-primary)"
        opacity={0.9}
      >
        {obs.range_m.toFixed(1)}m
      </text>
    </g>
  );
}

type AgentNodeProps = {
  agent: Agent;
  rep: number;
  status: Status;
  hovered: boolean;
  dimmed: boolean;
  flagTier1Fresh: number;
  flagTier2: boolean;
  onHover: (id: string | null) => void;
  setHint: SetHint;
};

const AgentNode = memo(
  function AgentNode({
  agent,
  rep,
  status,
  hovered,
  dimmed,
  flagTier1Fresh,
  flagTier2,
  onHover,
  setHint,
}: AgentNodeProps) {
  const isPhantom = agent.phantom === true;
  const color = isPhantom ? "var(--accent-primary)" : statusColor(status);
  const headingX = agent.x + Math.cos(agent.theta) * HEADING_LEN;
  const headingY = agent.y + Math.sin(agent.theta) * HEADING_LEN;
  const opacity = dimmed ? 0.45 : 1;
  const haloR = DRONE_R + 0.8;
  const xMarkR = DRONE_R + 0.8;
  const accuseR1 = DRONE_R + 1.6;
  const accuseR2 = DRONE_R + 2.6;
  return (
    <g
      data-agent-id={isPhantom ? undefined : agent.id}
      opacity={opacity}
      style={{ cursor: "pointer" }}
      onPointerEnter={() => {
        onHover(agent.id);
        setHint(agentHint(agent, rep, status, 0.4));
      }}
      onPointerLeave={() => {
        onHover(null);
        setHint(null);
      }}
    >
      {/* "Who is being accused" halos. Tier-2 (MDS colluder) takes the outer
          ring in accent-warn — always on while the chord is showing. Tier-1
          (reciprocity gap) takes a flagged-color ring whose strength fades
          with how recently the gap fired. Stacks beneath the hovered halo. */}
      {!isPhantom && flagTier2 ? (
        <>
          <circle
            cx={agent.x}
            cy={agent.y}
            r={accuseR2}
            fill="none"
            stroke="var(--accent-warn)"
            strokeOpacity={0.18}
            strokeWidth={0.9}
          />
          <circle
            cx={agent.x}
            cy={agent.y}
            r={accuseR2}
            fill="none"
            stroke="var(--accent-warn)"
            strokeOpacity={0.85}
            strokeWidth={0.3}
            strokeDasharray="1.2 0.6"
          />
        </>
      ) : null}
      {!isPhantom && flagTier1Fresh > 0.01 ? (
        <>
          <circle
            cx={agent.x}
            cy={agent.y}
            r={accuseR1}
            fill="none"
            stroke="var(--status-flagged)"
            strokeOpacity={0.18 * flagTier1Fresh}
            strokeWidth={0.8}
          />
          <circle
            cx={agent.x}
            cy={agent.y}
            r={accuseR1}
            fill="none"
            stroke="var(--status-flagged)"
            strokeOpacity={0.85 * flagTier1Fresh}
            strokeWidth={0.28}
            strokeDasharray="0.7 0.5"
          />
        </>
      ) : null}
      {hovered ? (
        <circle
          cx={agent.x}
          cy={agent.y}
          r={haloR}
          fill="none"
          stroke="var(--accent-primary)"
          strokeOpacity={0.7}
          strokeWidth={0.25}
          strokeDasharray="0.6 0.4"
        />
      ) : null}
      {isPhantom ? (
        <text
          x={agent.x}
          y={agent.y - DRONE_R - 3}
          fontSize={1.1}
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          fill="var(--accent-primary)"
          opacity={0.7}
          letterSpacing={0.2}
        >
          PHANTOM
        </text>
      ) : null}
      <circle
        cx={agent.x}
        cy={agent.y}
        r={DRONE_R}
        fill={color}
        fillOpacity={isPhantom ? 0.06 : 0.22}
        stroke={color}
        strokeWidth={0.25}
        strokeDasharray={isPhantom ? "0.5 0.4" : undefined}
      />
      {isPhantom ? null : (
        <line
          x1={agent.x}
          y1={agent.y}
          x2={headingX}
          y2={headingY}
          stroke={color}
          strokeWidth={0.3}
        />
      )}
      <text
        x={agent.x}
        y={agent.y - DRONE_R - 1.2}
        fontSize={LABEL_FONT}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill="var(--text-hi)"
      >
        {agent.id}
      </text>
      <text
        x={agent.x}
        y={agent.y + DRONE_R + REP_FONT + 0.8}
        fontSize={REP_FONT}
        fontFamily="var(--font-mono)"
        textAnchor="middle"
        fill={color}
      >
        {rep.toFixed(2)}
      </text>
      {status === "byzantine" ? (
        <>
          <line
            x1={agent.x - xMarkR}
            y1={agent.y - xMarkR}
            x2={agent.x + xMarkR}
            y2={agent.y + xMarkR}
            stroke={color}
            strokeWidth={STROKE_X}
          />
          <line
            x1={agent.x + xMarkR}
            y1={agent.y - xMarkR}
            x2={agent.x - xMarkR}
            y2={agent.y + xMarkR}
            stroke={color}
            strokeWidth={STROKE_X}
          />
        </>
      ) : null}
    </g>
  );
},
  (prev, next) =>
    prev.agent.id === next.agent.id &&
    prev.agent.x === next.agent.x &&
    prev.agent.y === next.agent.y &&
    prev.agent.theta === next.agent.theta &&
    prev.agent.phantom === next.agent.phantom &&
    prev.rep === next.rep &&
    prev.status === next.status &&
    prev.hovered === next.hovered &&
    prev.dimmed === next.dimmed &&
    prev.flagTier1Fresh === next.flagTier1Fresh &&
    prev.flagTier2 === next.flagTier2 &&
    prev.onHover === next.onHover,
);

function PerspectiveRangeCircle({
  obs,
  agentById,
  setHint,
}: {
  obs: Observation;
  agentById: Map<string, Agent>;
  setHint: SetHint;
}) {
  const observer = agentById.get(obs.observer_id);
  const subject = agentById.get(obs.subject_id);
  if (!observer || !subject) return null;
  const actualDist = Math.sqrt(
    (subject.x - observer.x) ** 2 + (subject.y - observer.y) ** 2,
  );
  const gap = Math.abs(obs.range_m - actualDist);
  const lying = gap > 0.5;
  const color = lying ? "var(--status-byzantine)" : "var(--accent-primary)";
  return (
    <g
      style={{ cursor: "help" }}
      onPointerEnter={() => setHint(rangeCircleHint(obs))}
      onPointerLeave={() => setHint(null)}
    >
      <circle
        cx={observer.x}
        cy={observer.y}
        r={obs.range_m}
        fill="none"
        stroke={color}
        strokeOpacity={lying ? 0.55 : 0.35}
        strokeWidth={0.18}
        strokeDasharray="0.8 0.5"
      />
      {lying ? (
        <line
          x1={subject.x}
          y1={subject.y}
          x2={observer.x + ((subject.x - observer.x) / actualDist) * obs.range_m}
          y2={observer.y + ((subject.y - observer.y) / actualDist) * obs.range_m}
          stroke="var(--status-byzantine)"
          strokeOpacity={0.9}
          strokeWidth={0.3}
        />
      ) : null}
    </g>
  );
}

function RangeCircle({
  obs,
  agentById,
  setHint,
}: {
  obs: Observation;
  agentById: Map<string, Agent>;
  setHint: SetHint;
}) {
  const observer = agentById.get(obs.observer_id);
  if (!observer) return null;
  return (
    <circle
      cx={observer.x}
      cy={observer.y}
      r={obs.range_m}
      fill="none"
      stroke="var(--status-byzantine)"
      strokeOpacity={0.35}
      strokeWidth={0.2}
      strokeDasharray="0.9 0.6"
      style={{ cursor: "help" }}
      onPointerEnter={() => setHint(rangeCircleHint(obs))}
      onPointerLeave={() => setHint(null)}
    />
  );
}

function MapStatusOverlay({
  detections,
  hoveredId,
  coverageGrid,
  currentTick,
  phantomCop,
  mapAttacks,
}: {
  detections: Record<string, DetectionState>;
  hoveredId: string | null;
  coverageGrid: CoverageGrid | undefined;
  currentTick: number;
  phantomCop: ReadonlyArray<CopEntry>;
  mapAttacks: ReadonlyArray<MapAttack>;
}) {
  const visible = hoveredId === null;
  const items = AO_WORLD.items;
  let coveredCells = 0;
  let totalCells = 0;
  if (coverageGrid) {
    totalCells = coverageGrid.cols * coverageGrid.rows;
    for (let i = 0; i < totalCells; i++) {
      const f = coverageGrid.firstSeen[i] ?? -1;
      if (f !== -1 && f <= currentTick) coveredCells++;
    }
  }
  const coveragePct = totalCells > 0 ? Math.round((coveredCells / totalCells) * 100) : 0;
  let mapped = 0;
  let verified = 0;
  let contested = 0;
  let unmapped = 0;
  let trustedConfirmations = 0;
  let untrustedConfirmations = 0;
  const perKind: Record<string, { mapped: number; total: number }> = {
    building: { mapped: 0, total: 0 },
    vehicle: { mapped: 0, total: 0 },
    uxo: { mapped: 0, total: 0 },
    fob: { mapped: 0, total: 0 },
  };
  for (const item of items) {
    const d = detections[item.id];
    perKind[item.kind]!.total++;
    if (!d || !d.detected) {
      unmapped++;
      continue;
    }
    mapped++;
    perKind[item.kind]!.mapped++;
    trustedConfirmations += d.trustedCount;
    untrustedConfirmations += d.untrustedCount;
    if (d.trustedCount >= 2 && d.untrustedCount === 0) verified++;
    else if (d.untrustedCount > 0) contested++;
  }
  const total = items.length;

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        padding: "10px 12px",
        background: "rgba(11, 13, 16, 0.92)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-mid)",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 220,
        maxHeight: "calc(100% - 60px)",
        overflowY: "auto",
        letterSpacing: 0.3,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-4px)",
        transition: "opacity 180ms ease-out, transform 180ms ease-out",
      }}
    >
      <span style={{ color: "var(--accent-primary)", letterSpacing: 1.2 }}>
        MAP STATUS
      </span>
      <ProgressBar label="AO swept" current={coveragePct} total={100} color="var(--lesson-intuition)" suffix="%" />
      <ProgressBar label="items" current={mapped} total={total} color="var(--accent-primary)" />
      <StatusRow label="verified" value={verified} hint="≥2 trusted obs" color="var(--status-nominal)" />
      <StatusRow label="contested" value={contested} hint="byz observer" color="var(--status-flagged)" />
      <StatusRow label="unmapped" value={unmapped} hint="no overflight" color="var(--text-low)" />
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <span style={{ color: "var(--text-low)", fontSize: 11.5, letterSpacing: 1 }}>
        BY KIND
      </span>
      <KindRow label="buildings" mapped={perKind.building!.mapped} total={perKind.building!.total} />
      <KindRow label="vehicles" mapped={perKind.vehicle!.mapped} total={perKind.vehicle!.total} />
      <KindRow label="UXO" mapped={perKind.uxo!.mapped} total={perKind.uxo!.total} />
      <KindRow label="friendly" mapped={perKind.fob!.mapped} total={perKind.fob!.total} />
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <span style={{ color: "var(--text-low)", fontSize: 11.5, letterSpacing: 1 }}>
        CONFIRMATIONS
      </span>
      <div style={{ display: "flex", gap: 10, fontSize: 11.5 }}>
        <span style={{ color: "var(--status-nominal)" }}>✓ {trustedConfirmations} trusted</span>
        <span style={{ color: "var(--status-byzantine)" }}>✗ {untrustedConfirmations} byz</span>
      </div>
      {mapAttacks.length > 0 ? (
        <CopFilterSection
          phantomCop={phantomCop}
          mapAttacks={mapAttacks}
          detections={detections}
        />
      ) : null}
    </div>
  );
}

function CopFilterSection({
  phantomCop,
  mapAttacks,
  detections,
}: {
  phantomCop: ReadonlyArray<CopEntry>;
  mapAttacks: ReadonlyArray<MapAttack>;
  detections: Record<string, DetectionState>;
}) {
  const alleged = mapAttacks.reduce((n, m) => n + m.phantomContacts.length, 0);
  const surviving = phantomCop.filter((p) => p.surviving).length;
  const filtered = phantomCop.filter((p) => !p.surviving).length;
  const pending = Math.max(0, alleged - phantomCop.length);

  const allSuppressed = new Set<string>();
  for (const m of mapAttacks) for (const id of m.suppressedItemIds) allSuppressed.add(id);
  let hidden = 0;
  let recovered = 0;
  let blackout = 0;
  for (const itemId of allSuppressed) {
    const d = detections[itemId];
    if (!d) continue;
    if (d.suppressedBy.length === 0) continue;
    hidden++;
    if (d.observers.length > 0) recovered++;
    else blackout++;
  }
  const pendingSuppression = Math.max(0, allSuppressed.size - hidden);
  const phantomReporters = [
    ...new Set(mapAttacks.filter((m) => m.phantomContacts.length > 0).map((m) => m.reporterId)),
  ].join(" · ");
  const suppressReporters = [
    ...new Set(mapAttacks.filter((m) => m.suppressedItemIds.length > 0).map((m) => m.reporterId)),
  ].join(" · ");

  return (
    <>
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <span style={{ color: "var(--status-byzantine)", fontSize: 11.5, letterSpacing: 1 }}>
        COP FILTER
      </span>
      {alleged > 0 ? (
        <>
          <StatusRow
            label="alleged"
            value={alleged}
            hint={`reported by ${phantomReporters}`}
            color="var(--text-mid)"
          />
          <StatusRow
            label="surviving"
            value={surviving}
            hint="in trust-fused COP"
            color={surviving > 0 ? "var(--status-byzantine)" : "var(--text-low)"}
          />
          <StatusRow
            label="filtered"
            value={filtered}
            hint="suppressed by trust"
            color={filtered > 0 ? "var(--status-nominal)" : "var(--text-low)"}
          />
          {pending > 0 ? (
            <StatusRow
              label="pre-attack"
              value={pending}
              hint="awaiting arm tick"
              color="var(--text-low)"
            />
          ) : null}
        </>
      ) : null}
      {allSuppressed.size > 0 ? (
        <>
          <StatusRow
            label="hidden"
            value={hidden}
            hint={`by ${suppressReporters}`}
            color={hidden > 0 ? "var(--status-byzantine)" : "var(--text-low)"}
          />
          <StatusRow
            label="recovered"
            value={recovered}
            hint="others surfaced"
            color={recovered > 0 ? "var(--status-nominal)" : "var(--text-low)"}
          />
          {blackout > 0 ? (
            <StatusRow
              label="blackout"
              value={blackout}
              hint="no other reporter"
              color="var(--status-byzantine)"
            />
          ) : null}
          {pendingSuppression > 0 ? (
            <StatusRow
              label="pre-encounter"
              value={pendingSuppression}
              hint="not yet near"
              color="var(--text-low)"
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ProgressBar({
  label,
  current,
  total,
  color,
  suffix,
}: {
  label: string;
  current: number;
  total: number;
  color: string;
  suffix?: string;
}) {
  const pct = total === 0 ? 0 : (current / total) * 100;
  const valueText = suffix === "%" ? `${current}${suffix}` : `${current}/${total}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ width: 70, color: "var(--text-low)" }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--surface-2)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span style={{ width: 40, textAlign: "right", color }}>{valueText}</span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: number;
  hint: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
      <span style={{ width: 70, color: "var(--text-low)" }}>{label}</span>
      <span style={{ width: 24, color, textAlign: "right" }}>{value}</span>
      <span style={{ color: "var(--text-low)", fontSize: 11.5, opacity: 0.7 }}>{hint}</span>
    </div>
  );
}

function KindRow({ label, mapped, total }: { label: string; mapped: number; total: number }) {
  const color = mapped === total ? "var(--status-nominal)" : "var(--text-mid)";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
      <span style={{ width: 70, color: "var(--text-low)" }}>{label}</span>
      <span style={{ color }}>{`${mapped}/${total}`}</span>
    </div>
  );
}

const NarrationBanner = memo(function NarrationBanner({
  lessonId,
  currentTick,
}: {
  lessonId: string | null;
  currentTick: number;
}) {
  if (!lessonId) return null;
  const steps = LESSON_NARRATION[lessonId];
  if (!steps || steps.length === 0) return null;
  // The active step is the latest one whose tick has been reached. Linear
  // scan is fine — narration scripts are <10 entries.
  let idx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]!.tick <= currentTick) idx = i;
  }
  const active = steps[idx]!;
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(60%, 560px)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px 8px",
        background: "rgba(11, 13, 16, 0.92)",
        border: "1px solid var(--border-subtle)",
        borderTop: "2px solid var(--accent-primary)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 1.0,
          color: "var(--accent-primary)",
          whiteSpace: "nowrap",
        }}
      >
        STEP {idx + 1}/{steps.length}
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          lineHeight: "17px",
          color: "var(--text-hi)",
        }}
      >
        {active.caption}
      </span>
    </div>
  );
});

const Legend = memo(function Legend() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        padding: collapsed ? "8px 10px" : "10px 12px",
        background: "rgba(11, 13, 16, 0.90)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        letterSpacing: 0.3,
        color: "var(--text-mid)",
        maxWidth: 240,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          all: "unset",
          color: "var(--accent-primary)",
          letterSpacing: 1,
          fontWeight: 700,
          fontSize: 11,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span>LEGEND</span>
      </button>
      {collapsed ? null : (
        <>
          <LegendHeader label="agents" />
          <LegendRow swatch="circle" color="var(--status-nominal)" label="trusted" />
          <LegendRow swatch="circle" color="var(--status-flagged)" label="flagged · suspect" />
          <LegendRow swatch="circle" color="var(--status-byzantine)" label="byzantine · cut" />
          <LegendRow swatch="halo" color="var(--status-byzantine)" label="phantom · no V3 presence" />
          <LegendHeader label="trust mechanism" />
          <LegendRow swatch="dash" color="var(--accent-primary)" label="signed observation" />
          <LegendRow swatch="solid" color="var(--status-byzantine)" label="tainted observation" />
          <LegendRow swatch="chevron" color="var(--status-flagged)" label="Tier-1 reciprocity gap" />
          <LegendRow swatch="dash" color="var(--accent-warn)" label="Tier-2 colluder chord" />
          <LegendRow swatch="rays" color="var(--accent-primary)" label="cohort vote · close" />
          <LegendHeader label="gossip & comms" />
          <LegendRow swatch="dot" color="var(--accent-primary)" label="gossip pulse · weighted" />
          <LegendRow swatch="thick" color="var(--accent-warn)" label="partition boundary (L06)" />
          <LegendRow swatch="arrow" color="var(--accent-primary)" label="seen-by · on hover" />
          <LegendHeader label="envelope & attack" />
          <LegendRow swatch="x" color="var(--status-byzantine)" label="envelope rejected" />
          <LegendRow swatch="ringPulse" color="var(--accent-warn)" label="attack ignition" />
          <LegendRow swatch="ring" color="var(--status-byzantine)" label="range circle · suspect" />
        </>
      )}
    </div>
  );
});

function LegendHeader({ label }: { label: string }) {
  return (
    <span
      style={{
        color: "var(--text-low)",
        letterSpacing: 1.2,
        fontSize: 9.5,
        textTransform: "uppercase",
        marginTop: 4,
      }}
    >
      {label}
    </span>
  );
}

function PerspectiveBadge({
  hoveredId,
  snapshot,
}: {
  hoveredId: string | null;
  snapshot: TickSnapshot | null;
}) {
  // Retain the last hovered id during fade-out so the panel doesn't blank
  // its contents the instant the cursor leaves.
  const [lastHoveredId, setLastHoveredId] = useState<string | null>(null);
  useEffect(() => {
    if (hoveredId !== null) setLastHoveredId(hoveredId);
  }, [hoveredId]);
  const displayId = hoveredId ?? lastHoveredId;
  const visible = hoveredId !== null;
  if (!displayId || !snapshot) return null;
  const outbound = snapshot.observations.filter((o) => o.observer_id === displayId);
  const observedSubjects = new Set(outbound.map((o) => o.subject_id));
  const rangeBySubject = new Map<string, number>();
  for (const o of outbound) rangeBySubject.set(o.subject_id, o.range_m);
  const ownView = snapshot.perAgentReputations[displayId] ?? snapshot.reputations;
  const ownBeta = snapshot.perAgentBeta?.[displayId];
  const selfRep = ownView[displayId];
  const peers = snapshot.agents
    .filter((a) => a.id !== displayId)
    .map((a) => {
      const ab = ownBeta?.[a.id];
      return {
        id: a.id,
        rep: ownView[a.id] ?? 0.5,
        observed: observedSubjects.has(a.id),
        range: rangeBySubject.get(a.id),
        alpha: ab?.[0],
        beta: ab?.[1],
      };
    })
    .sort((a, b) => b.rep - a.rep);

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: 12,
        padding: "10px 12px",
        background: "rgba(11, 13, 16, 0.92)",
        border: "1px solid var(--accent-primary)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-mid)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 220,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-4px)",
        transition: "opacity 180ms ease-out, transform 180ms ease-out",
      }}
    >
      <span style={{ color: "var(--accent-primary)", letterSpacing: 1 }}>
        PERSPECTIVE · {displayId}
      </span>
      <span style={{ color: "var(--text-low)", fontSize: 11.5 }}>
        {outbound.length} outbound obs · self rep {selfRep !== undefined ? selfRep.toFixed(2) : "—"}
      </span>
      <div style={{ height: 1, background: "var(--border-subtle)" }} />
      <span style={{ color: "var(--text-low)", fontSize: 11.5, letterSpacing: 1 }}>
        {displayId}'S VIEW · α β · rep · range
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {peers.map((p) => (
          <PeerRow key={p.id} peer={p} />
        ))}
      </div>
    </div>
  );
}

function PeerRow({
  peer,
}: {
  peer: {
    id: string;
    rep: number;
    observed: boolean;
    range: number | undefined;
    alpha: number | undefined;
    beta: number | undefined;
  };
}) {
  const repColor =
    peer.rep < 0.4 ? "var(--status-byzantine)" : peer.rep < 0.55 ? "var(--status-flagged)" : "var(--status-nominal)";
  const ab =
    peer.alpha !== undefined && peer.beta !== undefined
      ? `${peer.alpha.toFixed(1)}/${peer.beta.toFixed(1)}`
      : "—";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 24, color: peer.observed ? "var(--text-hi)" : "var(--text-low)" }}>
        {peer.id}
      </span>
      <span
        style={{
          width: 56,
          textAlign: "right",
          color: "var(--text-low)",
          fontSize: 11.5,
        }}
      >
        {ab}
      </span>
      <RepBar rep={peer.rep} color={repColor} />
      <span style={{ width: 32, textAlign: "right", color: repColor }}>{peer.rep.toFixed(2)}</span>
      <span
        style={{
          width: 44,
          textAlign: "right",
          color: peer.observed ? "var(--accent-primary)" : "var(--text-low)",
          fontSize: 11.5,
        }}
      >
        {peer.range !== undefined ? `${peer.range.toFixed(2)}m` : "—"}
      </span>
    </div>
  );
}

function RepBar({ rep, color }: { rep: number; color: string }) {
  const pct = Math.max(0, Math.min(1, rep)) * 100;
  return (
    <div
      style={{
        width: 48,
        height: 6,
        background: "var(--surface-2)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

type LegendSwatch =
  | "circle"
  | "dash"
  | "solid"
  | "thick"
  | "ring"
  | "halo"
  | "chevron"
  | "rays"
  | "dot"
  | "arrow"
  | "x"
  | "ringPulse";

function LegendRow({ swatch, color, label }: { swatch: LegendSwatch; color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 18,
          height: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {renderSwatch(swatch, color)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function renderSwatch(swatch: LegendSwatch, color: string): JSX.Element {
  switch (swatch) {
    case "circle":
      return (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 8,
            background: color,
            opacity: 0.55,
            border: `1px solid ${color}`,
          }}
        />
      );
    case "dash":
      return <span style={{ width: 16, height: 0, borderTop: `1px dashed ${color}` }} />;
    case "solid":
      return <span style={{ width: 16, height: 0, borderTop: `2px solid ${color}` }} />;
    case "thick":
      return <span style={{ width: 16, height: 0, borderTop: `3px solid ${color}` }} />;
    case "ring":
      return (
        <span
          style={{ width: 10, height: 10, borderRadius: 10, border: `1px dashed ${color}` }}
        />
      );
    case "halo":
      return (
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 12,
            border: `1.5px dashed ${color}`,
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 3,
              top: 3,
              width: 4,
              height: 4,
              borderRadius: 4,
              background: color,
              opacity: 0.55,
            }}
          />
        </span>
      );
    case "chevron":
      return (
        <svg width={18} height={12} viewBox="0 0 18 12">
          <polyline
            points="2,2 9,6 16,2 16,2 9,6 2,10"
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points="2,10 9,6 16,10"
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      );
    case "rays":
      return (
        <svg width={14} height={14} viewBox="-7 -7 14 14">
          <circle r={6} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="1.2 1.2" />
          <line x1={0} y1={0} x2={5.5} y2={0} stroke={color} strokeWidth={1.0} />
          <line x1={0} y1={0} x2={-3} y2={4.5} stroke="var(--surface-1)" strokeWidth={1.0} />
          <line x1={0} y1={0} x2={-3} y2={-4.5} stroke="var(--status-byzantine)" strokeWidth={1.0} />
        </svg>
      );
    case "dot":
      return (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 7,
            background: color,
            boxShadow: `0 0 4px ${color}`,
          }}
        />
      );
    case "arrow":
      return (
        <svg width={18} height={8} viewBox="0 0 18 8">
          <line
            x1={1}
            y1={4}
            x2={14}
            y2={4}
            stroke={color}
            strokeWidth={1.2}
            strokeDasharray="2 1.5"
            opacity={0.85}
          />
          <polyline
            points="12,1 16,4 12,7"
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "x":
      return (
        <svg width={12} height={12} viewBox="0 0 12 12">
          <line x1={2} y1={2} x2={10} y2={10} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
          <line x1={10} y1={2} x2={2} y2={10} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      );
    case "ringPulse":
      return (
        <svg width={14} height={14} viewBox="-7 -7 14 14">
          <circle r={5.5} fill="none" stroke={color} strokeWidth={1.2} opacity={0.4} />
          <circle r={3.5} fill="none" stroke={color} strokeWidth={1.0} opacity={0.7} />
          <circle r={1.5} fill={color} opacity={0.9} />
        </svg>
      );
  }
}

function ZoomBadge({
  scale,
  isZoomed,
  onReset,
}: {
  scale: number;
  isZoomed: boolean;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        background: "rgba(11, 13, 16, 0.90)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-mid)",
      }}
    >
      <span>{scale.toFixed(2)}×</span>
      {isZoomed ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
            color: "var(--accent-primary)",
          }}
        >
          reset
        </button>
      ) : (
        <span style={{ color: "var(--text-low)", fontSize: 11.5 }}>scroll · drag</span>
      )}
    </div>
  );
}

