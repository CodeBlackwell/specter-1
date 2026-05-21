# SPECTER-1 — Runbook (v0)

Field operations for a deployed swarm. Bring-up procedure, anomaly
category dictionary, and recovery procedures for the operational
failure modes Phase 1 actually encounters.

What this is NOT: a tuning guide (see `tests/eval/` for measured
attack-detection bands), an architecture overview (see `docs/PROGRESS.md`),
or a developer onboarding (see `docs/WORKSHOP_OUTLINE.md`).

---

## 1. Bring-up procedure

### 1.1 Operator-side (one-time per swarm formation)

```bash
# Generate operator key + signed roster YAML for the N robots in the swarm.
python tools/gen_roster.py --n 4 --output-dir ./deploy
# → ./deploy/roster.yaml
# → ./deploy/operator.pub.hex
# → ./deploy/keystore/{operator,alpha,bravo,charlie,delta}.key.pem (all mode 600)

# SROS2 keystore for signed-node DDS authentication.
ros2 security create_keystore ./deploy/sros2_keystore
for id in alpha bravo charlie delta; do
    ros2 security create_enclave ./deploy/sros2_keystore /$id
done
ros2 security create_enclave ./deploy/sros2_keystore /specter_dashboard
```

Distribute to each robot:
- `roster.yaml` (public)
- `operator.pub.hex` (public — trust root for verifying the roster)
- That robot's `keystore/{id}.key.pem` (private — never share)
- That robot's SROS2 enclave (private)

### 1.2 Per-robot (one-time per robot)

```bash
# Time sync — Phase 1 entry blocker. Without this, every peer envelope
# trips clock_skew_* the moment two robots boot at different times.
sudo cp infra/chrony.conf /etc/chrony/chrony.conf
sudo systemctl enable --now chronyd
chronyc tracking      # offset should converge < 100ms
chronyc sources       # ≥ 1 reachable peer marked '^*'

# Install the systemd unit (templated by agent_id).
sudo cp infra/systemd/specter-agent@.service /etc/systemd/system/
sudo cp infra/systemd/specter-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 1.3 Per-robot (every boot)

```bash
sudo systemctl start specter-agent@alpha   # alpha = this robot's roster ID
journalctl -u specter-agent@alpha -f       # tail logs
```

### 1.4 Operator station

```bash
sudo systemctl start specter-dashboard
journalctl -u specter-dashboard -f
```

Verify the operator dashboard window shows reputation bars for every
known peer within 30 seconds of bring-up.

---

## 2. Anomaly category dictionary

Every `AnomalyEvent` emitted by the trust engine carries a `category`
field. This table is the operator's reference for what each category
means, what to check first, and what to do.

| Category | Meaning | First check | Response |
|---|---|---|---|
| `bad_signature` | Envelope signature didn't verify against the roster's active key for that sender. | Did the sender's identity recently rotate? | If rotation is in flight, expect a brief flurry until the new key propagates. If sustained, investigate compromise (rotate or revoke). |
| `replay` | Envelope nonce ≤ last seen for that sender. Strict-monotonic gate fired. | Per-sender publish ordering. | Brief spikes are OK during partition recovery. Sustained → attacker capturing & replaying envelopes. Rotate the key. |
| `unknown_sender` | Envelope's `sender_id` not in the roster. | Did a new robot just join without a roster update? | Push an updated `roster.yaml` to all robots. If the sender_id is unrecognized entirely, it's an off-roster attacker — **drop their envelopes (already done), no action needed**. |
| `version_mismatch` / `unsupported_version` | Wire-format version in envelope ≠ the receiver's `WIRE_VERSION`. | Are all robots running the same specter-1 release? | Roll all robots to the same version. Mid-deployment version skew during a rolling update is expected and brief. |
| `key_revoked` | Sender's key is in the `RevocationList` at the envelope's timestamp. | Was this revocation intentional? | If yes, no action. If no, investigate the unauthorized `revoke()` call (audit the operator-station script log). |
| `key_revoked_post_rotation` | Envelope is signed by a key that was rotated out of the roster, post the rotation timestamp. | Is the sender behind on rotation announcements? | Brief during rotation propagation. Sustained → the sender is using a stolen pre-rotation key — rotate again immediately. |
| `unattested_key` | Sender's pubkey is not in the attestation allowlist. | Is `attestation_required` on, intentionally? | If yes and the pubkey is unexpected, this is a sybil attempting to mint identities from a compromised honest robot. Rotate the compromised host's key. |
| `clock_skew_future` | Envelope's `timestamp_ns` > wall_clock + 5s. | `chronyc tracking` on the sender. | Sender's clock is ahead. Force resync: `sudo chronyc makestep`. If the sender is genuinely a future attacker (replay+timestamp tweak), rotate. |
| `clock_skew_past` | Envelope's `timestamp_ns` < wall_clock - 5s. | `chronyc tracking` on the sender or the receiver. | Either clock could be wrong. Check both, force resync on the lagged one. |
| `no_beacon_presence` | Sender claims to see a peer that the receiver's own beacon sensor has never seen. | Is the receiver's UWB beacon working? | Heavy/sustained → sybil-mint attack OR real geometric anomaly (receiver's beacon failed). Check receiver's UWB hardware. |
| `range_inconsistency` | Sender's beacon range to a peer disagrees with reciprocal/cohort ranges beyond `RANGE_RECIPROCAL_K_SIGMA · σ_combined` (Tier 1), or appears as a top-residual peer in eigenvalue-residual MDS (Tier 2). | Is the sender's UWB calibrated? | Re-run the per-robot UWB calibration. If the sender persists in disagreement, suspect compromised UWB firmware (bias injection) or collusion with a paired peer (Tier 2 catches symmetric inflation). See ADR 0015 for the two-tier rule. |

Color buckets in the dashboard's anomaly panel:
- **Red (`ALERT`)** — categories that indicate an active attack or
  hard failure: `bad_signature`, `replay`, `unknown_sender`,
  `version_mismatch`, `key_revoked`, `key_revoked_post_rotation`,
  `unattested_key`, `unsupported`.
- **Gold** — categories that indicate sensor / clock / range
  anomalies (could be benign, could be malicious): `no_beacon_presence`,
  `range_inconsistency`, `clock_skew_*`.

---

## 3. Partition response

**Symptom:** dashboard shows reputation bars stuck at the last value
seen before the partition. Anomaly stream fills with `unknown_sender`
or stops entirely (no envelopes arriving).

**Diagnose:**

1. `ros2 topic list` — confirm topics still active on this side of the partition.
2. `ros2 topic echo /pose --once` — confirm envelopes are still flowing locally.
3. Compare reputation bars across both partitioned operator stations: if both
   stations show divergent reputation, the partition is real (not a single-node
   failure).

**What the engine does automatically:**

- The decay window (~100ms half-life under measured conditions, see ADR
  0013) drains stale reputations toward the prior over time. Robots in
  the partition that come back will rebuild reputation from the prior
  rather than from a frozen-stale value.
- The replay window stays per-sender, so a partitioned-then-rejoined
  peer will have its catch-up envelopes accepted by nonce monotonicity
  (no re-publish needed).

**What's NOT automated (Phase 1):**

- Partition recovery / split-brain reconciliation when two cliques
  rejoin with divergent trust state. This is owed by the
  policy-decisions PRD. Until then, **stop-action policy: prefer the
  partition with the operator station**; the off-partition robots
  should pause in place and not re-publish.

**Operator action:**

1. Confirm partition source (radio interference, network drop, etc.)
   and remediate the physical layer.
2. Once radio is restored, watch reputation bars rebuild from prior
   over the next ~30s.
3. If rebuild stalls → restart the affected agents (`systemctl restart
   specter-agent@<id>`).

---

## 4. Time-sync loss procedure

**Symptom:** `chronyc tracking` reports `Leap status : Not synchronised`
or `Reference ID : 00000000`. Dashboard fills with `clock_skew_future` /
`clock_skew_past` for nearly every peer.

**Expected behavior:** every envelope is rejected. The trust engine
treats all peers as unreachable; reputations decay toward prior.

**Recovery:**

```bash
chronyc tracking                # confirm unsync
chronyc sources                 # check if any NTP peer is reachable
chronyc makestep                # force a step to nearest reachable peer
sudo systemctl restart chronyd  # if no peers reachable — check upstream NTP server
```

After clock recovers, the agent_node automatically resumes accepting
envelopes (no restart needed — the `validate_timestamp` filter is
stateless beyond the wall-clock comparison).

For air-gapped deployments without internet NTP: provision a local
stratum-1 GPS receiver and point `infra/chrony.conf` at it.

---

## 5. Key rotation procedure

When a robot's key is suspected compromised (e.g., physical theft of
the keystore directory).

### 5.1 Choose: rotate (preferred) vs revoke

- **Rotate** if the robot is recoverable and the operator wants to
  bring it back online with a new key. Keeps the agent_id in the roster.
- **Revoke** if the robot is permanently compromised or destroyed.
  Removes the agent_id's key from the active roster; future envelopes
  rejected as `key_revoked`.

### 5.2 Rotate

```bash
# On the operator station:
# 1. Generate the new key + sign a KeyRotationAnnouncement with the OLD key.
#    (Today: manual; gen_roster.py --rotate-agent <id> is a follow-on tool.)
# 2. Publish the announcement to the swarm via ROS2 topic
#    `/specter/rotation_announcement`.
# 3. Apply locally, then push the new keystore/<id>.key.pem to the robot
#    over a secure side channel.
# 4. systemctl restart specter-agent@<id> on the robot.
```

After rotation, envelopes signed by the old key are rejected as
`key_revoked_post_rotation` (the trust engine distinguishes this from a
generic `bad_signature` so operators can tell apart "stolen old key
attack" from "wire corruption").

### 5.3 Revoke

```bash
# On the operator station:
# 1. Append the compromised pubkey to the RevocationList with
#    timestamp = now_ns.
# 2. Publish over `/specter/revocation` (today: manual; tooling owed).
# 3. Optionally, push an updated roster.yaml that omits the revoked
#    agent_id entirely so the agent appears as `unknown_sender` rather
#    than `key_revoked` to the dashboard.
```

---

## 6. Verify Phase 1 exit before any field deployment

```bash
# Headless smokes — must exit 0 before bringing up real hardware.
just agent-node alpha ./deploy
just dashboard ./deploy

# Phase 1 EXIT criterion (requires ROS2 sourced + opt-in flag):
just battery-multiprocess
```

Detection-tick latencies under DDS should land within `2 × InProcessBus
baseline + 5` ticks for `single_pose_liar`, `replay_storm`,
`sybil_flood (4:3)`, and `sybil_flood_mutual (4:3)`. If they don't,
investigate DDS configuration (QoS profile, security enclave) before
proceeding to Phase 2.
