export type RejectionReason = "signature" | "replay";

export type RejectionCausedByKind = "swap_key" | "replay_storm" | "forged_envelope";

export type RejectionEvent = {
  tick: number;
  reason: RejectionReason;
  fromId: string;
  fromX: number | null;
  fromY: number | null;
  toId: string;
  detail: string;
  /** For replays: the tick of the captured envelope being re-published. */
  originalSealTick?: number;
  /** The originating event that caused this rejection (key swap, replay start,
   * forged emitter onset). The UI uses this to surface temporal context in
   * the hover hint and to mark related ticks on the scrubber. */
  causedByEvent?: { kind: RejectionCausedByKind; atTick: number };
};

export function rejectionsAt(
  events: ReadonlyArray<RejectionEvent>,
  tick: number,
): RejectionEvent[] {
  return events.filter((e) => e.tick === tick);
}

export function rejectionsBefore(
  events: ReadonlyArray<RejectionEvent>,
  tick: number,
): RejectionEvent[] {
  return events.filter((e) => e.tick <= tick);
}
