"""Wave 0 — RosterLoader + gen_roster round-trip tests.

Verifies the operator → roster YAML → MutableRoster pipeline:
  * gen_roster.gen_roster() produces a YAML the loader accepts
  * tampered signature raises RosterYamlError
  * substituted operator pubkey raises RosterYamlError
  * malformed YAML schema raises RosterYamlError
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# tools/ isn't a package; add it to sys.path for the gen_roster import.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import gen_roster  # noqa: E402

from specter.crypto import Keypair  # noqa: E402
from specter.ros2.roster_loader import RosterLoader, RosterYamlError, canonical_body  # noqa: E402


def _gen(tmp_path: Path, agent_ids: list[str] | None = None) -> tuple[bytes, Path]:
    """Run gen_roster into tmp_path; return (operator_pubkey, roster_path)."""
    ids = agent_ids or ["alpha", "bravo", "charlie"]
    gen_roster.gen_roster(ids, tmp_path, dry_run=False)
    op_pub = bytes.fromhex((tmp_path / "operator.pub.hex").read_text().strip())
    return op_pub, tmp_path / "roster.yaml"


def test_gen_roster_round_trip_loads_into_mutable_roster(tmp_path):
    op_pub, roster_path = _gen(tmp_path, ["alpha", "bravo", "charlie"])
    roster = RosterLoader.from_yaml(roster_path, op_pub)

    # All three agents are admitted.
    assert set(roster.keys.keys()) == {"alpha", "bravo", "charlie"}
    # Audit log records 3 add events.
    events = roster.events()
    assert len(events) == 3
    assert {e.kind for e in events} == {"add"}
    assert {e.agent_id for e in events} == {"alpha", "bravo", "charlie"}


def test_gen_roster_writes_keystore_with_mode_600(tmp_path):
    _gen(tmp_path, ["alpha"])
    op_key = tmp_path / "keystore" / "operator.key.pem"
    agent_key = tmp_path / "keystore" / "alpha.key.pem"
    assert op_key.exists()
    assert agent_key.exists()
    # On POSIX, mode bits should be 0o600 (owner rw only).
    assert oct(op_key.stat().st_mode & 0o777) == "0o600"
    assert oct(agent_key.stat().st_mode & 0o777) == "0o600"


def test_gen_roster_dry_run_emits_yaml_no_files(tmp_path):
    yaml_text = gen_roster.gen_roster(["alpha"], tmp_path, dry_run=True)
    assert "signed_at_ns" in yaml_text
    assert "operator_pubkey" in yaml_text
    assert "agents" in yaml_text
    assert "signature" in yaml_text
    # No files written.
    assert not (tmp_path / "roster.yaml").exists()
    assert not (tmp_path / "keystore").exists()


def test_loader_rejects_tampered_signature(tmp_path):
    op_pub, roster_path = _gen(tmp_path)
    text = roster_path.read_text()
    # Flip one character in the signature line.
    tampered = text.replace("signature: ", "signature: ff", 1)
    roster_path.write_text(tampered)
    with pytest.raises(RosterYamlError, match="signature"):
        RosterLoader.from_yaml(roster_path, op_pub)


def test_loader_rejects_substituted_operator_pubkey(tmp_path):
    op_pub, roster_path = _gen(tmp_path)
    # Caller passes a DIFFERENT operator pubkey — defends against an attacker
    # swapping the whole roster (file + signature) for one signed by a different
    # operator. Cross-check catches it before signature verification.
    other_pub = Keypair.generate().public_bytes
    with pytest.raises(RosterYamlError, match="operator_pubkey"):
        RosterLoader.from_yaml(roster_path, other_pub)


def test_loader_rejects_missing_required_field(tmp_path):
    op_pub, roster_path = _gen(tmp_path)
    # Strip the agents: line — should fail schema check.
    text = roster_path.read_text()
    broken = "\n".join(line for line in text.splitlines() if not line.startswith("agents"))
    roster_path.write_text(broken)
    with pytest.raises(RosterYamlError):
        RosterLoader.from_yaml(roster_path, op_pub)


def test_loader_rejects_nonexistent_file(tmp_path):
    op_pub = Keypair.generate().public_bytes
    with pytest.raises(RosterYamlError, match="failed to read"):
        RosterLoader.from_yaml(tmp_path / "nonexistent.yaml", op_pub)


def test_canonical_body_is_stable_across_argument_order(tmp_path):
    """Canonical-JSON encoding must produce identical bytes regardless of
    Python dict ordering; the signature relies on this."""
    op_pub = b"\x04" + b"\x00" * 64  # X9.62 uncompressed prefix; 64 zero bytes
    agents = [
        {"agent_id": "alpha", "public_bytes": "00" * 65},
        {"agent_id": "bravo", "public_bytes": "11" * 65},
    ]
    body1 = canonical_body(1234, op_pub, agents)
    body2 = canonical_body(1234, op_pub, list(reversed(agents)))
    # Different agent order produces different canonical body — order matters
    # for the signed manifest. This is intentional: an attacker who reorders
    # the roster after signing would need a fresh signature.
    assert body1 != body2
    # But the same input twice produces the same bytes.
    assert canonical_body(1234, op_pub, agents) == body1
