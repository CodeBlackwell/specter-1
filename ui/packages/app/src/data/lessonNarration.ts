export type NarrationStep = {
  /** Absolute tick at which this caption becomes active. The first step
   *  should be tick 0 so the banner always has something to show. */
  tick: number;
  caption: string;
};

/** Tick-keyed step-through narration for lessons whose canvas behavior is
 *  easy to miss without a pointer to the right moment. Lessons not listed
 *  here render no banner. Tick numbers are calibrated against the lesson's
 *  attackStartTick in data/scenarios.ts and the default 35Hz playback
 *  (35 ticks ≈ 1 second of wall time). L3 pushes ignition to tick 105
 *  (~3s of formation) and spaces beats across the 900-tick scenario budget
 *  (~25.7s). */
export const LESSON_NARRATION: Record<string, ReadonlyArray<NarrationStep>> = {
  "03": [
    { tick: 0, caption: "Drones forming up — honest baseline, reciprocal ranges agree, the MDS embedding is clean." },
    { tick: 105, caption: "Formation settled. A0 + A1 begin symmetrically inflating their mutual range by 6 m." },
    { tick: 230, caption: "Tier 1 reciprocity shrugs — the colluders' numbers still match each other." },
    { tick: 380, caption: "MDS embeddability climbs past τ = 0.05 — three ranges can no longer embed in 2D." },
    { tick: 560, caption: "Colluder chord locks onto A0 ↔ A1 — Tier 2 has the geometry Tier 1 can't see." },
  ],
  "04": [
    { tick: 0, caption: "Honest baseline — UWB ranges noisy but within the 3σ envelope." },
    { tick: 30, caption: "A0's radio degrades — outbound ranges drift with σ = 5 m. No malice; bad hardware." },
    { tick: 36, caption: "Reciprocal gap exceeds the 3σ threshold — Tier 1 fires, same path as a lying actor." },
    { tick: 60, caption: "A0's reputation begins to fall: trust isn't only a security primitive, it's a robustness primitive." },
    { tick: 110, caption: "Bad data and bad actors look identical to the swarm — both get weighted down." },
  ],
};
