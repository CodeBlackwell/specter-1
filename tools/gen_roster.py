"""Operator keygen ceremony — produces signed roster YAML + per-agent keystore.

Run once at swarm formation. Generates:
  * `keystore/operator.key.pem` (mode 600) — operator's signing keypair
  * `keystore/<agent_id>.key.pem` (mode 600) for each agent_id
  * `roster.yaml` — signed manifest mapping agent_id → public key

The roster YAML is verified at agent_node bring-up by `RosterLoader.from_yaml`.
The operator pubkey is the trust root — it must be distributed out-of-band to
each robot so the YAML's signature can be checked against the right key.

USAGE
=====

    python tools/gen_roster.py --n 4 --output-dir ./deploy
    python tools/gen_roster.py --agent-ids alpha,bravo,charlie --output-dir ./deploy
    python tools/gen_roster.py --dry-run --n 4   # print YAML to stdout, no files

    # Resign an existing roster (operator-only — uses the existing operator key):
    python tools/gen_roster.py --resign --output-dir ./deploy

The --dry-run flag prints the canonical YAML to stdout WITHOUT writing any
files; useful for the foundation wave gate.

SECURITY
========

Private keys are written with mode 600 (owner read+write only). The script
refuses to overwrite an existing operator key without --force (catastrophic
to lose the trust root). Per-agent keys are overwriteable; rotation is the
proper path for a compromised agent (see KeyRotationAnnouncement).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives import serialization

# Allow running as `python tools/gen_roster.py` from repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "src"))

from specter.crypto import Keypair  # noqa: E402
from specter.ros2.roster_loader import canonical_body  # noqa: E402

DEFAULT_AGENT_IDS = ("alpha", "bravo", "charlie", "delta")


def _write_private_key(path: Path, keypair: Keypair, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"{path} already exists; use --force to overwrite")
    pem = keypair._private.private_bytes(  # noqa: SLF001 — accessing internal _private intentionally for serialization
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    path.write_bytes(pem)
    path.chmod(0o600)


def _load_or_generate_operator(keystore_dir: Path, force: bool, dry_run: bool) -> Keypair:
    op_path = keystore_dir / "operator.key.pem"
    if op_path.exists() and not force:
        # Load existing operator key — supports --resign without regenerating.
        from cryptography.hazmat.primitives.serialization import load_pem_private_key

        priv = load_pem_private_key(op_path.read_bytes(), password=None)
        return Keypair(priv)
    op_kp = Keypair.generate()
    if not dry_run:
        keystore_dir.mkdir(parents=True, exist_ok=True)
        _write_private_key(op_path, op_kp, force=True)
    return op_kp


def _generate_agent_keys(
    agent_ids: list[str], keystore_dir: Path, force: bool, dry_run: bool, resign: bool
) -> list[dict[str, str]]:
    agents: list[dict[str, str]] = []
    for agent_id in agent_ids:
        agent_path = keystore_dir / f"{agent_id}.key.pem"
        if resign and agent_path.exists():
            # Resign mode: keep existing keypair, just re-include in roster.
            from cryptography.hazmat.primitives.serialization import load_pem_private_key

            priv = load_pem_private_key(agent_path.read_bytes(), password=None)
            kp = Keypair(priv)
        else:
            kp = Keypair.generate()
            if not dry_run:
                _write_private_key(agent_path, kp, force=force)
        agents.append({"agent_id": agent_id, "public_bytes": kp.public_bytes.hex()})
    return agents


def gen_roster(
    agent_ids: list[str],
    output_dir: Path,
    *,
    dry_run: bool = False,
    force: bool = False,
    resign: bool = False,
) -> str:
    """Top-level generator. Returns the YAML string (also written to disk
    unless dry_run=True)."""
    keystore_dir = output_dir / "keystore"
    op_kp = _load_or_generate_operator(keystore_dir, force=force, dry_run=dry_run)
    agents = _generate_agent_keys(
        agent_ids, keystore_dir, force=force, dry_run=dry_run, resign=resign
    )

    signed_at_ns = time.time_ns()
    body = canonical_body(signed_at_ns, op_kp.public_bytes, agents)
    signature = op_kp.sign(body)

    roster = {
        "signed_at_ns": signed_at_ns,
        "operator_pubkey": op_kp.public_bytes.hex(),
        "agents": agents,
        "signature": signature.hex(),
    }
    # Emit as YAML (canonical-JSON only used inside the signed body — the
    # full file is human-readable YAML so operators can audit it visually).
    yaml_text = _to_yaml(roster)

    if not dry_run:
        roster_path = output_dir / "roster.yaml"
        roster_path.write_text(yaml_text)
        # Also write the operator pubkey separately for distribution
        # convenience (each robot needs this to verify the roster).
        (output_dir / "operator.pub.hex").write_text(op_kp.public_bytes.hex())

    return yaml_text


def _to_yaml(roster: dict[str, object]) -> str:
    """Hand-emit YAML — keeps key ordering stable and avoids pulling pyyaml
    just for emit (we already have it as a dep, but explicit ordering matters
    for visual diff stability)."""
    lines = [
        f"signed_at_ns: {roster['signed_at_ns']}",
        f"operator_pubkey: {roster['operator_pubkey']}",
        "agents:",
    ]
    for entry in roster["agents"]:  # type: ignore[union-attr]
        lines.append(f"  - agent_id: {entry['agent_id']}")  # type: ignore[index]
        lines.append(f"    public_bytes: {entry['public_bytes']}")  # type: ignore[index]
    lines.append(f"signature: {roster['signature']}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operator keygen + signed roster generator.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--n", type=int, help="Generate N agents named alpha, bravo, ...")
    group.add_argument("--agent-ids", help="Comma-separated agent_ids")
    parser.add_argument("--output-dir", type=Path, default=Path("./deploy"))
    parser.add_argument("--dry-run", action="store_true", help="Print YAML, don't write files")
    parser.add_argument("--force", action="store_true", help="Overwrite existing keystore")
    parser.add_argument(
        "--resign", action="store_true", help="Reuse existing keys, regenerate signature only"
    )
    args = parser.parse_args(argv)

    if args.agent_ids:
        agent_ids = [a.strip() for a in args.agent_ids.split(",") if a.strip()]
    elif args.n:
        if args.n > len(DEFAULT_AGENT_IDS):
            agent_ids = [f"agent_{i:02d}" for i in range(args.n)]
        else:
            agent_ids = list(DEFAULT_AGENT_IDS[: args.n])
    else:
        agent_ids = list(DEFAULT_AGENT_IDS)  # default: 4 agents

    yaml_text = gen_roster(
        agent_ids,
        args.output_dir,
        dry_run=args.dry_run,
        force=args.force,
        resign=args.resign,
    )

    if args.dry_run:
        print(yaml_text)
    else:
        print(f"[gen_roster] wrote {args.output_dir}/roster.yaml + keystore/", file=sys.stderr)
        print(f"[gen_roster] {len(agent_ids)} agents: {', '.join(agent_ids)}", file=sys.stderr)
        # Sanity: parse what we just wrote to confirm round-trip.
        from specter.ros2.roster_loader import RosterLoader

        roster_path = args.output_dir / "roster.yaml"
        op_pub = bytes.fromhex((args.output_dir / "operator.pub.hex").read_text().strip())
        roster = RosterLoader.from_yaml(roster_path, op_pub)
        assert len(roster.events()) == len(agent_ids), "round-trip mismatch"
        print("[gen_roster] verified roster.yaml round-trips through RosterLoader", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
