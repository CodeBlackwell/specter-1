/** Common Operating Picture aggregation — byte-equal parity to
 * `tests/eval/runner.py:build_cop` per ADR 0019.
 *
 * NOT to be confused with `ui/packages/app/src/sim/contacts.ts`, which is
 * the workshop console's *demonstrator* COP (different aggregation rule,
 * different thresholds, visually similar). The sim-core module here is the
 * reference implementation that parity fixtures gate against.
 *
 * Filter logic:
 *   1. Group ContactReports by `contact_id`.
 *   2. For each contact, collect the *distinct* set of reporter IDs.
 *   3. Average reporter reputations across distinct reporters
 *      (`avg_weight = mean(rep[r] for r in distinct_reporters)`).
 *   4. If `avg_weight < COP_TRUST_THRESHOLD`, drop the contact.
 *   5. Position is the mean (x, y) across *all* reports of that contact_id
 *      (so geometric jitter from multiple ticks rejects out).
 */

import type { ContactReport } from "./messages";
import type { Item } from "./items";

/** Per-tick map adversary primitive (ADR 0019). Mirrors
 * `tests/eval/runner.py:MapAttack`. */
export type MapAttack = {
  reporter_id: string;
  phantom_contacts: ReadonlyArray<Item>;
  suppressed_item_ids: ReadonlyArray<string>;
};

export type CopEntry = {
  contact_id: string;
  kind: string;
  x: number;
  y: number;
  weight: number;
  reporters: ReadonlyArray<string>;
};

export const COP_TRUST_THRESHOLD = 0.5;

export function buildCop(
  contactLog: ReadonlyArray<ContactReport>,
  reputations: Readonly<Record<string, number>>,
  threshold: number = COP_TRUST_THRESHOLD,
): Map<string, CopEntry> {
  if (contactLog.length === 0) return new Map();
  const byContact = new Map<string, ContactReport[]>();
  for (const cr of contactLog) {
    let bucket = byContact.get(cr.contact_id);
    if (!bucket) {
      bucket = [];
      byContact.set(cr.contact_id, bucket);
    }
    bucket.push(cr);
  }
  const cop = new Map<string, CopEntry>();
  for (const [cid, reports] of byContact) {
    const distinct = new Set<string>();
    for (const r of reports) distinct.add(r.reporter_id);
    const reporterIds = [...distinct].sort();
    const weights = reporterIds.map((rid) => reputations[rid] ?? 0.5);
    const avg = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0.0;
    if (avg < threshold) continue;
    const meanX = reports.reduce((a, r) => a + r.x, 0) / reports.length;
    const meanY = reports.reduce((a, r) => a + r.y, 0) / reports.length;
    cop.set(cid, {
      contact_id: cid,
      kind: reports[0]!.kind,
      x: meanX,
      y: meanY,
      weight: avg,
      reporters: reporterIds,
    });
  }
  return cop;
}

/** Generate ContactReports for one tick given the truth items, a per-peer
 * sensor radius, and any MapAttacks active this tick. Mirrors the Python
 * runner's per-tick contact-report synthesis: every honest peer within
 * sensor radius emits one report per visible Item; compromised reporters
 * emit phantoms and suppress real items per their MapAttack. */
export type PeerLocation = { id: string; x: number; y: number };

export function emitContactReportsThisTick(
  peers: ReadonlyArray<PeerLocation>,
  items: ReadonlyArray<Item>,
  mapAttacks: ReadonlyArray<MapAttack>,
  sensorRadiusM: number,
  timestampNs: bigint,
): ContactReport[] {
  const suppressionsByReporter = new Map<string, Set<string>>();
  const phantomsByReporter = new Map<string, ReadonlyArray<Item>>();
  for (const ma of mapAttacks) {
    suppressionsByReporter.set(ma.reporter_id, new Set(ma.suppressed_item_ids));
    phantomsByReporter.set(ma.reporter_id, ma.phantom_contacts);
  }
  const out: ContactReport[] = [];
  for (const peer of peers) {
    const suppressed = suppressionsByReporter.get(peer.id);
    for (const item of items) {
      if (suppressed && suppressed.has(item.id)) continue;
      const dx = peer.x - item.x;
      const dy = peer.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) > sensorRadiusM) continue;
      out.push({
        reporter_id: peer.id,
        contact_id: item.id,
        kind: item.kind,
        x: item.x,
        y: item.y,
        timestamp_ns: timestampNs,
      });
    }
    const phantoms = phantomsByReporter.get(peer.id);
    if (phantoms) {
      for (const ph of phantoms) {
        out.push({
          reporter_id: peer.id,
          contact_id: ph.id,
          kind: ph.kind,
          x: ph.x,
          y: ph.y,
          timestamp_ns: timestampNs,
        });
      }
    }
  }
  return out;
}
