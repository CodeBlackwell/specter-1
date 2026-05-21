export type LessonKeyCode = {
  title: string;
  file: string;
  language: "python" | "typescript";
  code: string;
  note?: string;
};

const REPO_BLOB = "https://github.com/CodeBlackwell/specter-1/blob/main";

export function keyCodeGithubUrl(file: string): string {
  return `${REPO_BLOB}/${file}`;
}

export const LESSON_KEY_CODE: Record<string, LessonKeyCode> = {
  "01": {
    title: "open_envelope — verify, then accept nonce",
    file: "src/specter/secure_bus.py",
    language: "python",
    code: `def open_envelope(env, roster, replay):
    pub = roster.keys.get(env.sender_id)
    if pub is None:
        raise VerificationError(f"unknown sender {env.sender_id}")
    blob = _signed_blob(env.version, env.sender_id, env.nonce,
                        env.timestamp_ns, env.kind, env.payload)
    if not verify(pub, blob, env.signature):
        raise VerificationError(f"bad signature from {env.sender_id}")
    if not replay.accept(env.sender_id, env.nonce):
        raise VerificationError(f"replay nonce={env.nonce}")
    return env.payload`,
    note: "Roster lookup → ECDSA verify → strictly-monotonic nonce. Forged and replayed packets die here; the trust layer never sees their bytes.",
  },
  "02": {
    title: "Beta decay — every silent tick halves accrued evidence",
    file: "src/specter/trust/evaluator.py",
    language: "python",
    code: `def _decay(self, rep):
    dt = self._decay_clock_ns - rep.last_update_ns
    if dt <= 0:
        return
    factor = 0.5 ** (dt / self._half_life_ns)   # 10s half-life
    rep.alpha = 1.0 + (rep.alpha - 1.0) * factor
    rep.beta  = 1.0 + (rep.beta  - 1.0) * factor
    rep.last_update_ns = self._decay_clock_ns

def reputation(self, peer_id):
    self._decay(rep)
    return rep.alpha / (rep.alpha + rep.beta)`,
    note: "Evidence above the (α=1, β=1) prior decays exponentially — a peer that stops misbehaving rehabilitates automatically.",
  },
  "03": {
    title: "MDS embeddability — colluder geometry is non-Euclidean",
    file: "src/specter/trust/mds.py",
    language: "python",
    code: `def embeddability_score(D):
    if D.shape[0] < 3:
        return 0.0                              # k=2 trivially embeds
    B = _double_center(D)                       # B = -½·J·D²·J
    eigvals = np.linalg.eigvalsh(B)
    eigvals = eigvals[np.argsort(-np.abs(eigvals))]
    top_two = np.abs(eigvals[:2]).sum() + 1e-12
    non_2d  = np.abs(eigvals[2:]).sum()
    return float(non_2d / top_two)              # > τ=0.05 → collusion`,
    note: "Three honest ranges must embed in 2D. The tail eigenvalues are the topological signature reciprocal checks structurally cannot see.",
  },
  "04": {
    title: "Tier 1 reciprocal gate — bad sensor looks like bad actor",
    file: "src/specter/trust/evaluator.py",
    language: "python",
    code: `# Reciprocal range check — fires on lies AND failing radios.
gap = abs(r_obs_to_subj - r_subj_to_obs)
threshold = RANGE_RECIPROCAL_K_SIGMA * sigma_range   # 3σ ≈ 99.7%
if gap > threshold:
    tier1_disagreements.append(
        (obs_id, subj_id, gap, threshold)
    )
# Symmetric β charge — both peers downweighted; decay sorts truth out.
self.observe(obs_id,  {"beta": TIER1_DISAGREE_BETA})
self.observe(subj_id, {"beta": TIER1_DISAGREE_BETA})`,
    note: "Trust is a robustness primitive, not just a security one. A degraded UWB radio and a malicious lie are the same signal to the swarm.",
  },
  "05": {
    title: "Sleeper grace bounded by the same Beta decay",
    file: "src/specter/trust/evaluator.py",
    language: "python",
    code: `# Accrued α above the prior is what an attacker "spends" on a flip.
# factor = 0.5 ** (dt / half_life_ns)
# rep.alpha = 1.0 + (rep.alpha - 1.0) * factor
#
# At half_life = 10s, every 10s of silence halves (α − 1).
# An hour of honest work caps at a bounded surplus — ~30s of grace
# ticks at most before β-evidence drives reputation below threshold.
# Detection latency for late_range_lie ≈ 350 ticks at t_flip=120.`,
    note: "The same machinery that lets noisy peers recover is what bounds how much trust a sleeper can bank for a betrayal.",
  },
  "06": {
    title: "Gossip discount — second-hand evidence is worth 10%",
    file: "src/specter/trust/evaluator.py",
    language: "python",
    code: `def record_gossip(self, env, gossip):
    # Weight = gossiper's own trust × global gossip discount.
    gossiper_w = (
        self._first_hand_score(env.sender_id) * GOSSIP_DISCOUNT  # 0.1
    )
    for peer_id, (a, b) in gossip.views.items():
        if peer_id == self._self_id:
            continue                            # ignore foreign views of self
        rep = self._reps[peer_id]
        self._decay(rep)
        rep.alpha += gossiper_w * (a - 1.0)
        rep.beta  += gossiper_w * (b - 1.0)`,
    note: "Reputation is eventually consistent across partitions. Hearsay counts, but at 10% of first-hand evidence, scaled by the gossiper's own score.",
  },
  "07": {
    title: "V3 presence — a granter only counts if self has met them",
    file: "src/specter/trust/evaluator.py",
    language: "python",
    code: `def _has_presence(self, peer_id, now_ns):
    if peer_id == self._self_id:
        return True
    granters = self._seen_by.get(peer_id, {})
    if self._self_id in granters:
        return True                             # (a) sticky existence
    for granter, ts in granters.items():
        if self._self_id not in self._seen_by.get(granter, {}):
            continue                            # self never beaconed granter
        if now_ns - ts < PRESENCE_WINDOW_NS:    # 2s freshness
            return True                         # (b) one-hop, fresh
    return False`,
    note: "Phantoms can vouch for each other all day. Without a real drone beaconing them, the cascade refuses the chain.",
  },
  "08": {
    title: "Trust-weighted COP — average reporter rep gates contacts",
    file: "ui/packages/sim-core/src/contacts.ts",
    language: "typescript",
    code: `for (const [cid, reports] of byContact) {
  const distinct = new Set(reports.map((r) => r.reporter_id));
  const reporterIds = [...distinct].sort();
  const weights = reporterIds.map((r) => reputations[r] ?? 0.5);
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  if (avg < COP_TRUST_THRESHOLD) continue;     // drop phantom contacts
  cop.set(cid, {
    contact_id: cid, kind: reports[0]!.kind,
    x: meanX, y: meanY, weight: avg, reporters: reporterIds,
  });
}`,
    note: "Contact reports aren't accepted or rejected — they're weighted by the reporter's reputation at report time. Honest consensus wins.",
  },
  "09": {
    title: "Loop closure — re-recognize a place, snap the chain",
    file: "src/specter/slam/loop_closure.py",
    language: "python",
    code: `def detect_loop_closure(scan, pose, merged_map, threshold_m=0.3):
    valid = [m for m in scan if math.isfinite(m.distance)]
    if len(valid) < MIN_VALID_BEAMS:
        return False
    grid = json.loads(merged_map)
    radius = max(1, int(math.ceil(threshold_m / grid["resolution"])))
    matches = 0
    for m in valid:
        wa = pose.theta + m.angle
        ex = pose.x + m.distance * math.cos(wa)
        ey = pose.y + m.distance * math.sin(wa)
        if _has_occupied_within(cells, ex/res, ey/res, radius, ...):
            matches += 1
    return matches / len(valid) >= MATCH_FRACTION`,
    note: "A virtual edge is inserted between matched keyframes; LM redistributes the residual along the chain and cost drops >10×.",
  },
  "10": {
    title: "Umeyama Sim(2) — closed-form inter-agent frame alignment",
    file: "src/specter/slam/pose_graph.py",
    language: "python",
    code: `def umeyama_sim2(src, dst):
    # Centroids + source variance.
    cx_s, cy_s = mean(src);  cx_d, cy_d = mean(dst)
    var_s = sum((p - c)**2 for p, c in zip(src, (cx_s, cy_s))) / n
    if var_s == 0.0: return None
    # 2D cross-covariance.
    sxx = Σ (src.x - cx_s)(dst.x - cx_d)
    syy = Σ (src.y - cy_s)(dst.y - cy_d)
    sxy = Σ (src.x - cx_s)(dst.y - cy_d)
    syx = Σ (src.y - cy_s)(dst.x - cx_d)
    # Rotation, scale, translation.
    theta = atan2(sxy - syx, sxx + syy)
    s = (sxx + syy) / (n * var_s)
    t = (cx_d, cy_d) - s · R(theta) · (cx_s, cy_s)`,
    note: "Recovers (R, t, s) from shared landmarks before joint optimization. Honest peers converge to scale ≈ 1.",
  },
  "11": {
    title: "Naive joint optimize — every factor weighted equally",
    file: "src/specter/slam/pose_graph.py",
    language: "python",
    code: `# Wave-1 joint optimize, no reputation channel.
for factor in factors:
    r, J = factor.residual_and_jacobian(state)
    H +=  J.T @ Omega @ J          # raw information matrix
    g += -J.T @ Omega @ r
delta = solve(H, g)
state = retract(state, delta)
# A0's pose lie has no reciprocal partner at the trust layer —
# range-only voting is structurally blind to it. The Hessian
# bakes A0's bad rows into the joint solution.`,
    note: "This is the exact failure that motivates ADR 0020. The geometry layer can see what the trust layer can't.",
  },
  "12": {
    title: "Exogenous-prior DCS — reputation rescales the information",
    file: "src/specter/slam/pose_graph.py",
    language: "python",
    code: `REPUTATION_FLOOR = 0.01
SLAM_CHISQ_OUTLIER = 5.991       # F(5.991, 2) = 0.95

# Direction 1: trust → SLAM
r = max(REPUTATION_FLOOR, reputation(source_id))
Omega_eff = r * w_gnc * Omega_base

# Direction 2: SLAM → trust (after LM converges)
for factor in factors:
    chi2 = r.T @ Omega_base @ r
    if chi2 > SLAM_CHISQ_OUTLIER:
        evaluator.observe(source_id, {"beta": 1.0})
    elif chi2 < SLAM_CHISQ_INLIER:
        evaluator.observe(source_id, {"alpha": 1.0})`,
    note: "Closes the loop. Reputation rescales factor information; residual statistics feed reputation back. Raw Ω used for classification — breaks the feedback loop, prevents oscillation.",
  },
  "13": {
    title: "Key rotation — same ECDSA gate, fresh roster key",
    file: "src/specter/secure_bus.py",
    language: "python",
    code: `# A0 stays in the roster, but the key it signs with no longer matches.
pub = roster.keys.get(env.sender_id)             # current roster pubkey
if pub is None:
    raise VerificationError(f"unknown sender {env.sender_id}")
if not verify(pub, blob, env.signature):
    raise VerificationError(f"bad signature from {env.sender_id}")
# MutableRoster + KeyRotationAnnouncement install a new pubkey;
# stale-keyed envelopes drop at the wire boundary — reputation
# never moves because the payload never reaches the evaluator.`,
    note: "The roster is a per-key contract, not a per-identity one. Rotation is how a compromised drone re-earns the channel safely.",
  },
  "14": {
    title: "Singleton cap + fade — uniqueness as a confidence penalty",
    file: "src/specter/slam/pose_graph.py",
    language: "python",
    code: `SINGLETON_INFO_SCALE = 0.3        # 1σ inflation 1/√0.3 ≈ 1.83×
T_CORROBORATE = 200               # ticks of full-cap grace
T_FADE = 200                      # ticks to fully decay past grace

def _singleton_scale(self, factor):
    # Cap fires only on landmarks with exactly one distinct reporter.
    if not self._singleton_cap_enabled:
        return 1.0
    lm_id = self._landmark_id_of(factor)
    if lm_id is None:
        return 1.0
    reporters = self._landmark_reporters.get(lm_id, set())
    if len(reporters) != 1:
        return 1.0
    scale = SINGLETON_INFO_SCALE
    if self._singleton_fade_enabled and self._current_tick is not None:
        prov = self._provenance.get(self._factor_key(factor))
        if prov is not None:
            delta = self._current_tick - prov.insertion_tick
            if delta > T_CORROBORATE:
                fade = max(0.0, 1.0 - (delta - T_CORROBORATE) / T_FADE)
                scale *= fade
    return scale

# Composed multiplicatively upstream of the rep prior and GNC:
#   Ω_eff = singleton_scale · r_now · w_gnc · Ω_base
# A second reporter lifts the cap; corroboration is the lift mechanism.`,
    note: "Two composing mechanisms (ADR 0022): the cap fires immediately on any single-reporter landmark, the fade decays toward zero past the corroboration window. Both opt-in via enable_singleton_cap / enable_singleton_fade to preserve the byte-exact parity contract for callers that don't migrate.",
  },
};
