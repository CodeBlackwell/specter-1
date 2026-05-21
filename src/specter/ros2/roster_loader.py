"""Signed roster YAML loader.

The deployment pattern: an operator runs `tools/gen_roster.py` once at swarm
formation to generate keypairs and produce a signed roster file. Each robot
ships with a copy of the roster YAML and the operator's public key (the
operator pubkey is the trust root — knowing it is what lets a robot tell
"signed by my operator" from "signed by anyone").

`RosterLoader.from_yaml(path, operator_pubkey)` parses the YAML, verifies the
operator's signature over the canonical-JSON encoding of the roster body, and
constructs a `MutableRoster` populated with all entries timestamped at
`signed_at_ns`.

Pure Python — no rclpy dependency. Works wherever the rest of the trust
stack works.

Schema (YAML):

    signed_at_ns: <int>          # operator wall-clock at signing
    operator_pubkey: <hex>       # echoed for cross-check; caller passes it too
    agents:
      - agent_id: alpha
        public_bytes: <hex>      # ECDSA P-256 X9.62 uncompressed
      - agent_id: bravo
        public_bytes: <hex>
    signature: <hex>             # operator signature over the body
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from specter.crypto import public_from_bytes, verify
from specter.identity import MutableRoster


class RosterYamlError(ValueError):
    """Raised on schema or signature error in a roster YAML."""


def canonical_body(signed_at_ns: int, operator_pubkey: bytes, agents: list[dict[str, Any]]) -> bytes:
    """Canonical-JSON encoding of the signed body.

    Used by both gen_roster (sign side) and RosterLoader (verify side) so the
    bytes-over-the-wire are identical. `pubkey` and `public_bytes` are hex-
    encoded in the JSON to keep the canonical form ASCII-safe.
    """
    body = {
        "signed_at_ns": int(signed_at_ns),
        "operator_pubkey": operator_pubkey.hex(),
        "agents": [
            {"agent_id": str(a["agent_id"]), "public_bytes": _coerce_hex(a["public_bytes"])}
            for a in agents
        ],
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode()


def _coerce_hex(value: Any) -> str:
    """Accept either bytes or hex-string (from YAML parse)."""
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def _from_hex(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    return bytes.fromhex(str(value))


class RosterLoader:
    """Load + verify a signed roster YAML."""

    @staticmethod
    def from_yaml(path: str | Path, operator_pubkey: bytes) -> MutableRoster:
        """Load roster YAML at `path`, verify operator signature, build MutableRoster.

        Raises `RosterYamlError` on:
          * missing/malformed YAML keys
          * `operator_pubkey` field doesn't match the caller's expected key
            (cross-check — defends against a tampered file with attacker-issued
            keys but the operator's signature over them)
          * bad operator signature over the canonical body
        """
        try:
            raw = yaml.safe_load(Path(path).read_text())
        except (OSError, yaml.YAMLError) as e:
            raise RosterYamlError(f"failed to read/parse {path}: {e}") from e

        if not isinstance(raw, dict):
            raise RosterYamlError(f"roster YAML must be a mapping, got {type(raw).__name__}")

        try:
            signed_at_ns = int(raw["signed_at_ns"])
            file_op_pubkey = _from_hex(raw["operator_pubkey"])
            agents = list(raw["agents"])
            signature = _from_hex(raw["signature"])
        except (KeyError, TypeError, ValueError) as e:
            raise RosterYamlError(f"roster YAML schema error: {e}") from e

        if file_op_pubkey != operator_pubkey:
            raise RosterYamlError(
                "operator_pubkey in roster does not match caller's expected key — "
                "possible roster substitution attack"
            )

        body = canonical_body(signed_at_ns, operator_pubkey, agents)
        try:
            op_pub = public_from_bytes(operator_pubkey)
        except Exception as e:
            raise RosterYamlError(f"operator_pubkey is not a valid EC point: {e}") from e

        if not verify(op_pub, body, signature):
            raise RosterYamlError("operator signature over roster body does not verify")

        roster = MutableRoster()
        for entry in agents:
            try:
                agent_id = str(entry["agent_id"])
                pub_bytes = _from_hex(entry["public_bytes"])
            except (KeyError, TypeError, ValueError) as e:
                raise RosterYamlError(f"agent entry malformed: {entry!r} ({e})") from e
            roster.add_peer(agent_id, pub_bytes, t_ns=signed_at_ns)
        return roster
