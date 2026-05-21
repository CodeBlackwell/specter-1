export type LessonPreview = {
  problem: string;
  solution: string;
  proof: string;
};

export const LESSON_PREVIEW: Record<string, LessonPreview> = {
  "01": {
    problem: "Outsiders can inject messages onto the bus and replay captured packets.",
    solution: "Sign every envelope with ECDSA P-256; track per-sender nonce high-water marks.",
    proof: "Forged + replayed packets fail at the wire boundary — the trust layer never sees them.",
  },
  "02": {
    problem: "If one bad tick banned a drone forever, every sensor glitch would kill the mission.",
    solution: "Beta(α, β) reputation with a 10-second exponential decay that forgives old evidence.",
    proof: "A0 lies for 200 ticks, collapses to the floor, then recovers toward the prior as honest data accrues.",
  },
  "03": {
    problem: "Two colluders can vouch for each other — pairwise reciprocal checks miss them.",
    solution: "Three ranges must embed in 2D; MDS embeddability flags the geometric impossibility.",
    proof: "Symmetric +6 m lie between A0/A1 crosses τ=0.05; residuals point straight at the pair.",
  },
  "04": {
    problem: "Will the system false-alarm on degraded radios and NLOS multipath bounces?",
    solution: "Same Tier 1 gate — to the swarm, a failing sensor and a lying actor are both bad data.",
    proof: "A0 with σ=5 m noise gets weighted down, calibrated against the DWM1000 noise floor.",
  },
  "05": {
    problem: "An attacker that stays honest for an hour banks trust to spend later when it flips.",
    solution: "The decay half-life bounds how much accrued α survives — sleeper grace is finite.",
    proof: "Flip at t=120 caught within ~350 ticks, bounded by the 10 s decay on accrued evidence.",
  },
  "06": {
    problem: "If the swarm partitions, does the disconnected half ever learn who's lying?",
    solution: "Periodic gossip carries reputation summaries, discounted by the gossiper's own trust.",
    proof: "Local clique catches A0 directly; the far clique converges over gossip rounds at 0.1×.",
  },
  "07": {
    problem: "What stops the adversary from spinning up fake drones that vouch for each other?",
    solution: "V3 presence — a granter only counts if self has personally beaconed them recently.",
    proof: "Phantom pair S0/S1 stays mutually invisible; reputations collapse within tens of ticks.",
  },
  "08": {
    problem: "A drone can lie about the ground itself — phantom UXOs, hidden FOBs, false hostiles.",
    solution: "Trust-weighted COP: contact reports get weighted by reporter reputation at report time.",
    proof: "Once A0's reputation collapses, phantoms drop below threshold; real contacts stay surfaced.",
  },
  "09": {
    problem: "Single-agent SLAM drifts — IMU bias compounds and the path walks off the truth.",
    solution: "Loop closure re-observes known landmarks; LM redistributes residual along the chain.",
    proof: "Cost drops >10× on the 12-pose rectangular loop; estimate snaps onto the truth path.",
  },
  "10": {
    problem: "Four independent SLAM solves leave shared landmarks unconstrained across robots.",
    solution: "Inter-robot factors + Umeyama Sim(2) alignment knit the four pose graphs together.",
    proof: "Joint cost converges below the sum of four independent solves on the same scenario.",
  },
  "11": {
    problem: "One peer lying about its pose pulls the whole joint map off — the optimizer trusts equally.",
    solution: "Demonstrates the gap: range-only trust voting is structurally blind to pose lies.",
    proof: "A0's lie pulls the joint estimate ~1.25 m off; honest peers' maps corrupted by association.",
  },
  "12": {
    problem: "How does the trust layer learn about a pose lie when its only input is range data?",
    solution: "Trust → SLAM via exogenous-prior DCS; SLAM → trust via per-factor χ² residual evidence.",
    proof: "Across 5 LM cycles, A0's reputation drops and the joint map recovers within ~5 cm of truth.",
  },
  "13": {
    problem: "A drone in the signed roster whose key gets rotated, stolen, or swapped mid-mission.",
    solution: "Every envelope re-verifies against the roster's current public key for that agent.",
    proof: "Bad-keyed traffic drops with unknown_sender at the wire — reputation never moves.",
  },
  "14": {
    problem: "A peer lies about a landmark only it ever observes — no residual disagreement to detect.",
    solution: "Singleton confidence cap (0.3×) + stale-singleton fade (decay to 0 over 400 ticks).",
    proof: "Ω_eff = 0.3 · r_now · Ω_base = 0.003 once A0's rep collapses — 3.3× rep-independent reduction.",
  },
};
