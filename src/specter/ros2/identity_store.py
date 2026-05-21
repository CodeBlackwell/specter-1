"""Disk-backed identity loader for `agent_node`.

Reads a PEM-encoded ECDSA private key produced by `tools/gen_roster.py`
(written as `keystore/{agent_id}.key.pem` with mode 600) and returns a
ready-to-use `Identity` object.

Mode 600 is enforced — refuse if a key is world- or group-readable, since
that's a deployment misconfiguration that defeats the trust root. The
agent_id is derived from the filename stem (`alpha.key.pem` → `alpha`)
unless overridden.

POSIX-only: mode bits are checked via `stat().st_mode`. Windows
deployments would need a different ACL check; not in scope for Phase 1
(robots are Linux).
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key

from specter.crypto import Keypair
from specter.secure_bus import Identity


class IdentityStoreError(RuntimeError):
    """Raised on bad permissions or unparseable key file."""


def _agent_id_from_path(path: Path) -> str:
    name = path.name
    if name.endswith(".key.pem"):
        return name[: -len(".key.pem")]
    return path.stem


def load_identity(path: str | Path, agent_id: str | None = None) -> Identity:
    """Load an `Identity` from a PEM private key on disk.

    Refuses files with group/world bits set (mode > 0o600) on POSIX. The
    agent_id defaults to the filename stem (`alpha.key.pem` → `alpha`) but
    can be overridden when the on-disk filename doesn't match the deployed
    identity (e.g., key migration).
    """
    p = Path(path)
    try:
        st = p.stat()
    except OSError as e:
        raise IdentityStoreError(f"cannot stat {p}: {e}") from e
    if os.name == "posix" and (st.st_mode & (stat.S_IRWXG | stat.S_IRWXO)) != 0:
        raise IdentityStoreError(
            f"{p} has group/world bits set (mode={oct(st.st_mode & 0o777)}); "
            f"refusing to load — chmod 600 the key file"
        )
    try:
        priv = load_pem_private_key(p.read_bytes(), password=None)
    except Exception as e:
        raise IdentityStoreError(f"failed to parse PEM at {p}: {e}") from e
    if not isinstance(priv, EllipticCurvePrivateKey):
        raise IdentityStoreError(
            f"{p} is not an ECDSA P-256 key (got {type(priv).__name__})"
        )
    return Identity(agent_id or _agent_id_from_path(p), Keypair(priv))
