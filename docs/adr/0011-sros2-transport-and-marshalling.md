ADR 0011: SROS2 transport + envelope marshalling
==================================================

Status: Accepted (2026-05-05)

Context
-------

Phase 1 ships envelope-level signing (`secure_bus.Envelope` + ECDSA per
ADR 0002) over `InProcessBus`. Phase 03 swap targets ROS2 with SROS2
signed-node DDS as the runtime transport (ADR 0006). Two integration
questions need answering:

1. **Carrier choice** — what ROS2 message type carries an envelope.
2. **Layer redundancy** — whether to keep envelope signing once SROS2
   signed-node DDS is in place, or collapse one layer.

Decision
--------

### Carrier: `std_msgs/ByteMultiArray`

`envelope_to_ros_msg` packs the canonical-JSON `envelope_to_wire(env)`
bytes into `ByteMultiArray.data` (one-byte entries, matching rclpy's
generated shape). `ros_msg_to_envelope` is the inverse.

Why a byte container, not a typed `.msg`:

- The envelope contract (`Envelope` dataclass + canonical-JSON wire
  format) is fixed across phases by ADR 0003. Defining a separate
  `.msg` schema would couple the wire format to ROS2's idl, fork the
  representation, and put the DDS layer in a position to silently
  reformat signed bytes — which would invalidate signatures.
- Canonical JSON (sorted keys, `,:` separators) is what the signature
  was computed over. Any reserialization at the transport layer is a
  signature break. Treating the envelope as opaque bytes inside the
  ROS message keeps the byte sequence authoritative.
- Future protobuf migration (ADR 0003) is a same-shape swap: the wire
  format changes, the ROS-side representation does not.

Trade-off accepted: `ByteMultiArray` is a coarse type — a ROS2 tooling
user inspecting topics with `ros2 topic echo` sees a byte vector, not a
human-readable struct. We trade that introspection for byte-stable
signature semantics. A debug topic that re-publishes decoded envelopes
as a typed `.msg` is a future tool-side helper, not a transport-layer
change.

### Layer policy: keep both signatures and SROS2

Envelope signing and SROS2 signed-node DDS are kept side by side.
Neither replaces the other.

What each layer protects against:

| Threat | Envelope signing | SROS2 signed-node |
|---|---|---|
| Bus-internal forgery (in-process bug, malicious node within the same DDS domain that has a valid SROS2 cert) | Catches | Allows |
| Off-domain attacker on the network (no SROS2 cert) | Catches | Catches (DDS rejects unauth peers) |
| Replay of past envelopes (same DDS domain) | Catches (replay window + nonce) | Allows |
| Unattested-hardware key minting sybils (with valid SROS2 cert) | Catches via `AttestationRequiredFilter` (ADR 0009) | Allows |
| Compromised SROS2 keystore (attacker holds a valid node enclave) | Catches (envelope still requires the agent's signing key) | Allows |
| Compromised envelope signing key (attacker holds the agent's ECDSA key) | Allows | Catches if attacker is off-domain; allows if on-domain |

Defense in depth: a compromise of one layer does not collapse the
other. The cost — two key materials per agent (DDS enclave + ECDSA
keypair), one extra verify per envelope — is bounded and a single-digit
microsecond delta per message on Cortex-A class hardware.

`Sros2Bus` therefore wires the existing receive-side composition
(`validate_timestamp` → `MutableRoster.lookup` → `RevocationList` →
`AttestationRequiredFilter` → handler) on top of DDS-authenticated
delivery; it does not short-circuit any check.

Setup procedure
---------------

The runtime SROS2 setup is documented in `examples/ros2_demo.py`'s
module docstring. Summary:

1. Install ROS2 Humble or later, source the setup script.
2. `pip install rclpy` (system-level; uv venvs don't see the ROS2
   bindings).
3. Generate keystore: `ros2 security create_keystore <path>`.
4. Per-node enclave: `ros2 security create_enclave <path> /<node>`.
5. Set env: `ROS_SECURITY_KEYSTORE`, `ROS_SECURITY_ENABLE=true`,
   `ROS_SECURITY_STRATEGY=Enforce`.
6. `make_secure_node(name, keystore_path)` constructs an
   SROS2-configured `rclpy.Node`.

Consequences
------------

Positive:
- Wire bytes are the same on `InProcessBus` and `Sros2Bus`. Existing
  signature, replay, revocation, attestation paths are unchanged.
- Rolling SROS2 enclaves can happen without touching envelope signing
  state, and vice versa.
- Future protobuf swap or new envelope fields don't require new ROS2
  message definitions.

Negative:
- `ros2 topic echo` shows raw bytes. Operators need a small
  decode-and-print helper for ad-hoc debugging.
- `ByteMultiArray.data` is `list[bytes]`, one byte per entry. Per-byte
  serialization overhead is non-trivial for very large payloads. The
  largest envelope category in this project is reputation gossip; sized
  tests show overhead remains well under DDS's per-message budget. If a
  future payload (e.g. raw lidar fragments) breaches that budget, swap
  to a typed `.msg` carrying the wire bytes as a single `uint8[]`.
- Two layers means two failure modes. A mis-provisioned keystore
  produces a `rclpy` error; a mis-provisioned roster produces a
  `VerificationError`. The runbook has to differentiate.

Revisit when
------------

- Per-message overhead from `ByteMultiArray` becomes measurable on
  target hardware (Crazyflie+UWB radios in particular have tight
  per-frame budgets).
- A typed `.msg` for envelopes would unblock a tooling need that the
  byte container blocks (e.g. ROS2-native bag inspection without a
  custom decoder).
- DDS-level capabilities (e.g. SROS2 access-control policies on per-
  topic publish/subscribe) overlap enough with the envelope-level
  filters that one layer becomes redundant for a specific deployment.
