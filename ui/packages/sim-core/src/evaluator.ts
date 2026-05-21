import { zeros, type Matrix } from "./linalg";
import { embeddabilityScore, lyingEdgeResiduals } from "./mds";
import { decay, newReputation, score, type PeerReputation } from "./reputation";

export const RANGE_RECIPROCAL_K_SIGMA = 3.0;
export const SIGMA_BEACON_RANGE_M = 0.10;
export const SIGMA_NLOS_RANGE_M = 0.07;
export const TIER1_DISAGREE_BETA = 0.5;
export const MIN_OBSERVER_WEIGHT = 0.1;
export const MIN_K_FOR_TIER2 = 3;
export const MDS_EMBEDDABILITY_TAU = 0.05;
export const MDS_LYING_EDGE_M = 0.8;
export const MDS_BETA_CAP = 1.0;
export const DECAY_HALF_LIFE_NS = 10_000_000_000n;
export const GOSSIP_DISCOUNT = 0.1;
export const PRESENCE_WINDOW_NS = 2_000_000_000n;
export const PRESENCE_BETA = 1.0;
export const OBSERVATION_PRESENCE_BETA = 0.2;
export const ACCEPT_ALPHA = 0.1;

export type RejectCategory =
  | "bad_signature"
  | "replay"
  | "unknown_sender"
  | "version_mismatch"
  | "unknown";

export type AnomalyEvent = {
  sender_id: string;
  category: RejectCategory;
  nonce: bigint;
  timestamp_ns: bigint;
  detail: string;
};

export type TierUsed = "t1" | "t2" | "skip";

export type CohortClaim = { observer_id: string; range_m: number };

export type CohortEvent = {
  subject_id: string;
  timestamp_ns: bigint;
  observer_count: number;
  fired: boolean;
  tier_used: TierUsed;
  median_range_m: number | null;
  embeddability_score: number | null;
  /** Per-observer range claims (presentation-only). Empty when fired=false. */
  claims: ReadonlyArray<CohortClaim>;
  /** Observer ids whose claim was β-charged this round (Tier-1 disagreers or
   * Tier-2 lying edge participants). Subset of claims[].observer_id. */
  outlier_observer_ids: ReadonlyArray<string>;
};

const RANGE_SIGMA = Math.sqrt(
  SIGMA_BEACON_RANGE_M * SIGMA_BEACON_RANGE_M + SIGMA_NLOS_RANGE_M * SIGMA_NLOS_RANGE_M,
);

export function rangeSigma(): number {
  return RANGE_SIGMA;
}

type CohortKey = string;
type CohortRow = { observer_id: string; range_m: number; sigma_r: number };

const cohortKey = (subject: string, ts: bigint): CohortKey => `${subject}@${ts.toString()}`;

export type EvaluatorOptions = {
  halfLifeNs?: bigint;
  rangeKSigma?: number;
  selfId?: string;
  gossipDiscount?: number;
  acceptAlpha?: number;
};

export class BetaTrustEvaluator {
  private readonly _peers = new Map<string, PeerReputation>();
  private readonly _pending = new Map<CohortKey, CohortRow[]>();
  private readonly _pendingTs = new Map<CohortKey, bigint>();
  private readonly _voted = new Set<CohortKey>();
  private readonly _cohortLog: CohortEvent[] = [];
  private readonly _seenBy = new Map<string, Map<string, bigint>>();
  private readonly _gossipViews = new Map<string, Map<string, PeerReputation>>();
  private readonly _chargedNoPresence = new Set<string>();
  private _decayClockNs = 0n;
  private readonly _halfLifeNs: bigint;
  private readonly _rangeKSigma: number;
  private readonly _selfId: string | undefined;
  private readonly _gossipDiscount: number;
  private readonly _acceptAlpha: number;
  private readonly _anomalies: AnomalyEvent[] = [];

  constructor(opts: EvaluatorOptions = {}) {
    this._halfLifeNs = opts.halfLifeNs ?? DECAY_HALF_LIFE_NS;
    this._rangeKSigma = opts.rangeKSigma ?? RANGE_RECIPROCAL_K_SIGMA;
    this._selfId = opts.selfId;
    this._gossipDiscount = opts.gossipDiscount ?? GOSSIP_DISCOUNT;
    this._acceptAlpha = opts.acceptAlpha ?? ACCEPT_ALPHA;
  }

  /** Charge α for a successfully verified envelope (signature + roster + replay).
   * Mirrors Python `record_accept`. */
  recordAccept(senderId: string, timestampNs: bigint): void {
    if (timestampNs > this._decayClockNs) this._decayClockNs = timestampNs;
    this.observe(senderId, { alpha: this._acceptAlpha });
  }

  /** Charge β for a failed envelope verification + record categorized anomaly.
   * Mirrors Python `record_reject`. */
  recordReject(
    senderId: string,
    timestampNs: bigint,
    nonce: bigint,
    category: RejectCategory,
    detail: string,
  ): void {
    if (timestampNs > this._decayClockNs) this._decayClockNs = timestampNs;
    this.observe(senderId, { beta: 1.0 });
    this._anomalies.push({
      sender_id: senderId,
      category,
      nonce,
      timestamp_ns: timestampNs,
      detail,
    });
  }

  anomalies(): ReadonlyArray<AnomalyEvent> {
    return this._anomalies;
  }

  reputation(peerId: string): number {
    if (peerId === this._selfId) return 1.0;
    const own = this._peer(peerId);
    decay(own, this._decayClockNs, this._halfLifeNs);
    let alpha = own.alpha;
    let beta = own.beta;
    for (const [gossiperId, views] of this._gossipViews) {
      const view = views.get(peerId);
      if (!view) continue;
      decay(view, this._decayClockNs, this._halfLifeNs);
      const weight = this._firstHandScore(gossiperId) * this._gossipDiscount;
      alpha += weight * (view.alpha - 1.0);
      beta += weight * (view.beta - 1.0);
    }
    const total = alpha + beta;
    if (total <= 0) return 0.5;
    return alpha / total;
  }

  observe(peerId: string, evidence: { alpha?: number; beta?: number }): void {
    const rep = this._peer(peerId);
    decay(rep, this._decayClockNs, this._halfLifeNs);
    if (evidence.alpha) rep.alpha += evidence.alpha;
    if (evidence.beta) rep.beta += evidence.beta;
  }

  recordObservation(
    observerId: string,
    subjectId: string,
    rangeM: number,
    timestampNs: bigint,
  ): void {
    if (timestampNs > this._decayClockNs) {
      this._decayClockNs = timestampNs;
      this._voteClosedCohorts();
    }
    let granters = this._seenBy.get(subjectId);
    if (!granters) {
      granters = new Map();
      this._seenBy.set(subjectId, granters);
    }
    granters.set(observerId, timestampNs);
    if (
      this._selfId !== undefined &&
      this._seenBy.size > 0 &&
      subjectId !== this._selfId &&
      !this._hasPresence(subjectId, timestampNs)
    ) {
      this.observe(observerId, { beta: OBSERVATION_PRESENCE_BETA });
    }
    const key = cohortKey(subjectId, timestampNs);
    const row: CohortRow = { observer_id: observerId, range_m: rangeM, sigma_r: rangeSigma() };
    let bucket = this._pending.get(key);
    if (!bucket) {
      bucket = [];
      this._pending.set(key, bucket);
      this._pendingTs.set(key, timestampNs);
    }
    bucket.push(row);
  }

  recordPoseReport(agentId: string, timestampNs: bigint): void {
    const clockAdvanced = timestampNs > this._decayClockNs;
    if (clockAdvanced) this._decayClockNs = timestampNs;
    if (this._seenBy.size > 0 && !this._hasPresence(agentId, timestampNs)) {
      if (!this._chargedNoPresence.has(agentId)) {
        this._chargedNoPresence.add(agentId);
        this.observe(agentId, { beta: PRESENCE_BETA });
      }
    } else if (this._hasPresence(agentId, timestampNs)) {
      this._chargedNoPresence.delete(agentId);
    }
    if (clockAdvanced) this._voteClosedCohorts();
  }

  recordGossip(gossiperId: string, views: Record<string, [number, number]>, timestampNs: bigint): void {
    const clockAdvanced = timestampNs > this._decayClockNs;
    if (clockAdvanced) this._decayClockNs = timestampNs;
    if (clockAdvanced) this._voteClosedCohorts();
    if (gossiperId === this._selfId) return;
    let bucket = this._gossipViews.get(gossiperId);
    if (!bucket) {
      bucket = new Map();
      this._gossipViews.set(gossiperId, bucket);
    }
    for (const targetId of Object.keys(views)) {
      if (targetId === this._selfId) continue;
      const view = views[targetId];
      if (!view || view.length !== 2) continue;
      bucket.set(targetId, {
        alpha: view[0],
        beta: view[1],
        lastUpdateNs: this._decayClockNs,
      });
    }
  }

  gossipSnapshot(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [peerId, rep] of this._peers) {
      if (peerId === this._selfId) continue;
      decay(rep, this._decayClockNs, this._halfLifeNs);
      out[peerId] = [rep.alpha, rep.beta];
    }
    return out;
  }

  hasPresence(peerId: string, nowNs: bigint): boolean {
    return this._hasPresence(peerId, nowNs);
  }

  /** First-hand-only score for `peerId` (gossip excluded). Used by the
   * scenario layer to expose the weight applied to each gossiper's view
   * during a gossip round, so the UI can render propagation. */
  firstHandScore(peerId: string): number {
    return this._firstHandScore(peerId);
  }

  gossipDiscount(): number {
    return this._gossipDiscount;
  }

  /** Snapshot of the seen-by graph: subjectId → observerId → most-recent
   * beacon timestamp. Lets the UI render V3 presence — phantoms with no
   * real-agent granters are visibly stranded. Inner maps are cloned so
   * the caller can't mutate internal state. */
  seenByGraph(): Map<string, Map<string, bigint>> {
    const out = new Map<string, Map<string, bigint>>();
    for (const [subjectId, granters] of this._seenBy) {
      out.set(subjectId, new Map(granters));
    }
    return out;
  }

  private _hasPresence(peerId: string, nowNs: bigint): boolean {
    if (peerId === this._selfId) return true;
    const granters = this._seenBy.get(peerId);
    if (!granters) return false;
    if (this._selfId !== undefined) {
      if (granters.has(this._selfId)) return true;
      for (const [granterId, ts] of granters) {
        if (granterId === this._selfId || granterId === peerId) continue;
        const granterGranters = this._seenBy.get(granterId);
        if (!granterGranters || !granterGranters.has(this._selfId)) continue;
        if (nowNs - ts < PRESENCE_WINDOW_NS) return true;
      }
      return false;
    }
    for (const [observerId, ts] of granters) {
      if (observerId === peerId) continue;
      if (nowNs - ts < PRESENCE_WINDOW_NS) return true;
    }
    return false;
  }

  flush(): void {
    for (const key of this._pending.keys()) {
      if (this._voted.has(key)) continue;
      this._vote(key);
      this._voted.add(key);
    }
  }

  cohortEvents(): ReadonlyArray<CohortEvent> {
    return this._cohortLog;
  }

  private _peer(id: string): PeerReputation {
    let rep = this._peers.get(id);
    if (!rep) {
      rep = newReputation();
      this._peers.set(id, rep);
    }
    return rep;
  }

  private _firstHandScore(id: string): number {
    const rep = this._peers.get(id);
    if (!rep) return 0.5;
    decay(rep, this._decayClockNs, this._halfLifeNs);
    return score(rep);
  }

  private _voteClosedCohorts(): void {
    const clock = this._decayClockNs;
    for (const [key, ts] of this._pendingTs) {
      if (ts >= clock) continue;
      if (this._voted.has(key)) continue;
      this._vote(key);
      this._voted.add(key);
    }
  }

  private _lookupRange(fromId: string, toId: string, ts: bigint): number | null {
    const cohort = this._pending.get(cohortKey(toId, ts));
    if (!cohort) return null;
    for (const row of cohort) {
      if (row.observer_id === fromId) return row.range_m;
    }
    return null;
  }

  private _findReciprocal(
    observerId: string,
    subjectId: string,
    ts: bigint,
  ): { range_m: number; sigma_r: number } | null {
    const recip = this._pending.get(cohortKey(observerId, ts));
    if (!recip) return null;
    for (const row of recip) {
      if (row.observer_id === subjectId) {
        return { range_m: row.range_m, sigma_r: row.sigma_r };
      }
    }
    return null;
  }

  private _vote(key: CohortKey): void {
    const parts = key.split("@");
    const subjectId = parts[0]!;
    const ts = BigInt(parts[1] ?? "0");
    const claims = this._pending.get(key);
    if (!claims) return;

    const weighted = claims.map((row) => ({
      observer_id: row.observer_id,
      range_m: row.range_m,
      sigma_r: row.sigma_r,
      weight:
        this._firstHandScore(row.observer_id) *
        (this._hasPresence(row.observer_id, ts) ? 1.0 : 0.0),
    }));

    if (!weighted.some((w) => w.weight >= MIN_OBSERVER_WEIGHT)) {
      this._cohortLog.push({
        subject_id: subjectId,
        timestamp_ns: ts,
        observer_count: claims.length,
        fired: false,
        tier_used: "skip",
        median_range_m: null,
        embeddability_score: null,
        claims: [],
        outlier_observer_ids: [],
      });
      return;
    }

    let tierUsed: TierUsed = "t1";
    let embeddability: number | null = null;
    let outliers = new Set<string>();
    let tier2Ran = false;

    if (weighted.length >= MIN_K_FOR_TIER2) {
      const r = this._runTier2(subjectId, ts, weighted);
      if (r.score !== null) {
        tier2Ran = true;
        embeddability = r.score;
        if (r.score > MDS_EMBEDDABILITY_TAU) {
          tierUsed = "t2";
          outliers = r.outliers;
        }
      }
    }

    const disagreements: Array<{ obs: string; subj: string; gap: number; threshold: number }> = [];
    const subjectScore = this._firstHandScore(subjectId);
    for (const w of weighted) {
      if (w.weight < MIN_OBSERVER_WEIGHT) continue;
      if (subjectScore < MIN_OBSERVER_WEIGHT) continue;
      if (outliers.has(w.observer_id) || outliers.has(subjectId)) continue;
      const reciprocal = this._findReciprocal(w.observer_id, subjectId, ts);
      if (!reciprocal) continue;
      const combined = Math.sqrt(
        w.sigma_r * w.sigma_r + reciprocal.sigma_r * reciprocal.sigma_r,
      );
      const gap = Math.abs(w.range_m - reciprocal.range_m);
      const threshold = this._rangeKSigma * combined;
      if (gap <= threshold) {
        this.observe(w.observer_id, { alpha: 1.0 });
        this.observe(subjectId, { alpha: 1.0 });
      } else {
        disagreements.push({ obs: w.observer_id, subj: subjectId, gap, threshold });
      }
    }

    const tier1ChargedObservers = new Set<string>();
    if (disagreements.length > 0) {
      if (tier2Ran && outliers.size === 0) {
        const participation = new Map<string, number>();
        for (const d of disagreements) {
          participation.set(d.obs, (participation.get(d.obs) ?? 0) + 1);
          participation.set(d.subj, (participation.get(d.subj) ?? 0) + 1);
        }
        const counts = [...participation.values()].sort((a, b) => b - a);
        const max = counts[0]!;
        const second = counts[1] ?? 0;
        const dominant = max >= 2 && max >= 2 * second;
        if (dominant) {
          const suspects = [...participation.entries()].filter(([, c]) => c === max);
          if (suspects[0]) {
            this.observe(suspects[0][0], {
              beta: TIER1_DISAGREE_BETA * disagreements.length,
            });
            tier1ChargedObservers.add(suspects[0][0]);
          }
        }
      } else if (!tier2Ran) {
        for (const d of disagreements) {
          this.observe(d.obs, { beta: TIER1_DISAGREE_BETA });
          this.observe(d.subj, { beta: TIER1_DISAGREE_BETA });
          tier1ChargedObservers.add(d.obs);
        }
      }
    }

    const ranges = weighted.map((w) => w.range_m).sort((a, b) => a - b);
    const median = ranges.length > 0 ? ranges[Math.floor(ranges.length / 2)]! : null;
    const claimRows: CohortClaim[] = weighted.map((w) => ({
      observer_id: w.observer_id,
      range_m: w.range_m,
    }));
    const claimantIds = new Set(weighted.map((w) => w.observer_id));
    const outlierObserverIds: string[] = [];
    if (tierUsed === "t2") {
      for (const o of outliers) if (claimantIds.has(o)) outlierObserverIds.push(o);
    } else {
      for (const o of tier1ChargedObservers) if (claimantIds.has(o)) outlierObserverIds.push(o);
    }
    this._cohortLog.push({
      subject_id: subjectId,
      timestamp_ns: ts,
      observer_count: claims.length,
      fired: true,
      tier_used: tierUsed,
      median_range_m: median,
      embeddability_score: embeddability,
      claims: claimRows,
      outlier_observer_ids: outlierObserverIds,
    });
  }

  private _runTier2(
    subjectId: string,
    ts: bigint,
    weighted: ReadonlyArray<{ observer_id: string; range_m: number; sigma_r: number; weight: number }>,
  ): { score: number | null; outliers: Set<string> } {
    const observerIds = weighted.map((w) => w.observer_id);
    const peerIds = [subjectId, ...observerIds];
    const n = peerIds.length;
    const D: Matrix = zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = peerIds[i]!;
        const b = peerIds[j]!;
        const rAB = this._lookupRange(a, b, ts);
        const rBA = this._lookupRange(b, a, ts);
        if (rAB === null && rBA === null) return { score: null, outliers: new Set() };
        let avg: number;
        if (rAB !== null && rBA !== null) avg = (rAB + rBA) / 2;
        else if (rAB !== null) avg = rAB;
        else avg = rBA!;
        D[i]![j] = avg;
        D[j]![i] = avg;
      }
    }

    const score = embeddabilityScore(D);
    if (score <= MDS_EMBEDDABILITY_TAU) return { score, outliers: new Set() };

    const edge = lyingEdgeResiduals(D);
    let maxResidual = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (edge[i]![j]! > maxResidual) maxResidual = edge[i]![j]!;
      }
    }
    if (maxResidual < MDS_LYING_EDGE_M) return { score, outliers: new Set() };

    const high: boolean[][] = [];
    let nLyingEdges = 0;
    for (let i = 0; i < n; i++) {
      const row: boolean[] = [];
      for (let j = 0; j < n; j++) {
        const flag = i !== j && edge[i]![j]! >= MDS_LYING_EDGE_M;
        row.push(flag);
        if (flag && j > i) nLyingEdges++;
      }
      high.push(row);
    }
    const edgeCount = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (high[i]![j]) edgeCount[i]!++;
      }
    }
    const sortedCounts = [...edgeCount].sort((a, b) => b - a);
    const outliers = new Set<string>();

    if (sortedCounts[0]! >= 2 && sortedCounts[0]! >= 2 * (sortedCounts[1] ?? 0)) {
      const topIdx = edgeCount.indexOf(sortedCounts[0]!);
      const peer = peerIds[topIdx]!;
      outliers.add(peer);
      this.observe(peer, { beta: Math.min(MDS_BETA_CAP, maxResidual / 2.0) });
      return { score, outliers };
    }

    if (nLyingEdges === 1) {
      let bestI = 0;
      let bestJ = 0;
      let best = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          if (edge[i]![j]! > best) {
            best = edge[i]![j]!;
            bestI = i;
            bestJ = j;
          }
        }
      }
      outliers.add(peerIds[bestI]!);
      outliers.add(peerIds[bestJ]!);
      const charge = Math.min(MDS_BETA_CAP, maxResidual / 2.0);
      this.observe(peerIds[bestI]!, { beta: charge });
      this.observe(peerIds[bestJ]!, { beta: charge });
      return { score, outliers };
    }

    return { score, outliers: new Set() };
  }
}
