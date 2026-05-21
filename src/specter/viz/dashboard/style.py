"""Render constants: geometry, palette, anomaly category buckets."""

from __future__ import annotations

# ── Render geometry ────────────────────────────────────────────────────────
SCALE = 50
PADDING = 24
HIST_W = 200
HIST_H = 100
HIST_WINDOW_NS = 10_000_000_000

# ── Color palette ──────────────────────────────────────────────────────────
PEER_COLORS = (
    (122, 155, 94), (201, 169, 97), (90, 140, 200),
    (188, 120, 188), (212, 88, 58), (170, 170, 170),
)
PANEL = (17, 21, 15)
DIVIDER = (40, 45, 35)
INK_DIM = (138, 143, 125)
GOLD = (201, 169, 97)
ALERT = (212, 88, 58)

# ── Anomaly category buckets ───────────────────────────────────────────────
ALERT_CATEGORIES = frozenset({
    "bad_signature", "replay", "unknown_sender", "version_mismatch",
    "key_revoked", "key_revoked_post_rotation", "unattested_key", "unsupported",
})
GOLD_CATEGORIES = frozenset({
    "no_beacon_presence", "range_inconsistency",
    "clock_skew_future", "clock_skew_past",
})

# ── Plain-English category subtitles ──────────────────────────────────────
CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "bad_signature": "ECDSA signature failed verify",
    "replay": "nonce ≤ last seen — replay rejected",
    "unknown_sender": "sender not in roster",
    "version_mismatch": "envelope version unsupported",
    "key_revoked": "pubkey on revocation list",
    "key_revoked_post_rotation": "old key after rotation effective_t",
    "unattested_key": "attest required, key not in allowlist",
    "unsupported": "envelope kind not understood",
    "no_beacon_presence": "claimed beacon presence impossible",
    "range_inconsistency": "reciprocal range disagreement",
    "clock_skew_future": "timestamp > now + max_skew",
    "clock_skew_past": "timestamp < now − max_skew",
}


def to_screen(x: float, y: float, world_h: float) -> tuple[int, int]:
    """World-frame meters → screen-frame pixels (y-axis flipped)."""
    return int(x * SCALE + PADDING), int((world_h - y) * SCALE + PADDING)


def to_screen_scaled(
    x: float, y: float, world_h: float,
    scale: float, ox: int, oy: int,
) -> tuple[int, int]:
    """World-frame meters → pixels using a runtime scale + origin offset."""
    return int(x * scale + ox), int((world_h - y) * scale + oy)
