"""Unified visual + cryptographic demo for specter-1.

Single live showcase of every capability the codebase ships. The runtime
is split into three columns:

    [ WORLD CANVAS ] [ STATE + LEGEND + KEYBINDINGS ] [ EVENT STREAM ]

WORLD CANVAS draws ground-truth physics, lidar rays, SLAM ghosts, and a
confidence-tiered cooperative-merge grid (1, 2+, ≥6 corroborating votes
shown in three colors). Lies are rendered explicitly: a red dashed
"claim ghost" sits at the lied position with an arrow from real → claim,
sybils render at their *claimed* fake position with a dashed tether to
the corroboration target, and rejection tracers (red ✗) puff on any
sender whose envelope was just thrown out by the receive chain.

STATE column shows the legend, the live swarm-state ledger (compromised
set, liars, sybils → target, revoked keys, skew, attestation, bus,
recording), and the always-visible keybindings cheatsheet.

EVENT STREAM shows per-peer reputation, the 10-second sparkline, a
collapsed anomaly stream (`× N` counters group repeats by category +
sender), and a collapsed envelope log.

Press G to launch the guided tour: a scripted X → L → R → T → Y → A → K
sequence with one-line narration toasts.

Orchestration primitives (`build_swarm`, `step`, `apply_attack`,
`snapshot`, `start_tour`) live in `specter.demo`. Render helpers reused
by the operator dashboard live in `specter.viz.dashboard`.
"""

from __future__ import annotations

import argparse
import math
import os
import time

import pygame

from specter.sim.beacons import BEACON_MAX_RANGE_M
from specter.demo import (
    LIE_OFFSET,
    RenderSnapshot,
    apply_attack,
    build_swarm,
    snapshot,
    start_tour,
    step,
)
from specter.viz.dashboard import (
    ALERT,
    ALERT_CATEGORIES,
    CATEGORY_DESCRIPTIONS,
    DIVIDER,
    GOLD,
    GOLD_CATEGORIES,
    HIST_H,
    HIST_W,
    INK_DIM,
    PADDING,
    PANEL,
    draw_anomaly_stream,
    draw_history_overlay,
    draw_keymap_panel,
    draw_legend,
    draw_merged_grid,
    draw_state_panel,
    draw_toast,
    to_screen_scaled,
)

# ── Colors ────────────────────────────────────────────────────────────────
BG = (10, 13, 10)
WALL = (212, 216, 200)
RAY = (122, 155, 94)
AGENT = (201, 169, 97)
AGENT_BAD = (212, 88, 58)
GHOST = (90, 90, 105)
INK = (212, 216, 200)
GREEN = (122, 155, 94)
SYBIL_GRAY = (140, 140, 145)
SKEW_BLUE = (120, 160, 210)
REVOKED = (110, 30, 30)
CLAIM_RED = (220, 100, 80)         # ghost color for lied claims
CONFIDENCE_LOW = (138, 143, 125)   # ≥1 vote (single observer)
CONFIDENCE_MID = (175, 180, 110)   # ≥2 votes (corroborated)
CONFIDENCE_HIGH = (122, 200, 110)  # ≥6 votes (well-confirmed)
TRACER_TTL_TICKS = 6
LIDAR_STRIDE = 20
GOSSIP_STRIDE = 200

# ── Layout ────────────────────────────────────────────────────────────────
DEFAULT_WIN = (1700, 1000)
STATE_W = 360
STREAM_W = 420
STATUS_H = 30
HISTORY_H = 150
TOAST_TTL_S = 2.5

# =============================================================================
# CLI
# =============================================================================


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="specter-1 unified demo")
    p.add_argument("--scenario", default=os.environ.get(
        "SPECTER_DEMO_SCENARIO", "scenarios/four_agents_corridor.yaml"))
    p.add_argument("--bus", default=os.environ.get("SPECTER_DEMO_BUS", "inproc"),
                   choices=("inproc", "lossy", "sros2"))
    p.add_argument("--cadences", action="store_true",
                   default=os.environ.get("SPECTER_DEMO_CADENCES") == "1")
    p.add_argument("--fullscreen", action="store_true")
    p.add_argument("--width", type=int, default=DEFAULT_WIN[0])
    p.add_argument("--height", type=int, default=DEFAULT_WIN[1])
    max_env = os.environ.get("SPECTER_DEMO_MAX_TICKS")
    p.add_argument("--max-ticks", type=int, default=int(max_env) if max_env else None)
    return p.parse_args()


# =============================================================================
# View transform — runtime scale + origin for the world canvas
# =============================================================================


class View:
    """World ↔ canvas transform. Recomputed on resize / zoom."""

    def __init__(self, world_w: float, world_h: float) -> None:
        self.world_w = world_w
        self.world_h = world_h
        self.canvas_x = 0
        self.canvas_y = 0
        self.canvas_w = 0
        self.canvas_h = 0
        self.zoom = 1.0
        self.scale = 1.0
        self.ox = 0
        self.oy = 0

    def fit(self, x: int, y: int, w: int, h: int) -> None:
        self.canvas_x, self.canvas_y, self.canvas_w, self.canvas_h = x, y, w, h
        usable_w = max(1, w - 2 * PADDING)
        usable_h = max(1, h - 2 * PADDING)
        base = min(usable_w / self.world_w, usable_h / self.world_h)
        self.scale = base * self.zoom
        used_w = self.world_w * self.scale
        used_h = self.world_h * self.scale
        self.ox = x + int((w - used_w) / 2)
        self.oy = y + int((h - used_h) / 2)

    def w2s(self, x: float, y: float) -> tuple[int, int]:
        return to_screen_scaled(x, y, self.world_h, self.scale, self.ox, self.oy)


# =============================================================================
# Sim-aware glyphs
# =============================================================================


def agent_triangle_pts(view: View, x: float, y: float, theta: float) -> list[tuple[int, int]]:
    nose = (x + 0.30 * math.cos(theta), y + 0.30 * math.sin(theta))
    left = (x + 0.20 * math.cos(theta + 2.6), y + 0.20 * math.sin(theta + 2.6))
    right = (x + 0.20 * math.cos(theta - 2.6), y + 0.20 * math.sin(theta - 2.6))
    return [view.w2s(*p) for p in (nose, left, right)]


def draw_agent(screen, view: View, agent, *, color, dashed: bool = False) -> None:
    pts = agent_triangle_pts(view, agent.x, agent.y, agent.theta)
    pygame.draw.polygon(screen, color, pts)
    outline = REVOKED if dashed else BG
    pygame.draw.polygon(screen, outline, pts, 1)


def draw_ghost(screen, view: View, x: float, y: float, theta: float) -> None:
    pts = agent_triangle_pts(view, x, y, theta)
    pygame.draw.polygon(screen, GHOST, pts, 1)


def draw_lidar(screen, view: View, agent, scans) -> None:
    ax, ay = view.w2s(agent.x, agent.y)
    for m in scans:
        if math.isinf(m.distance):
            continue
        wa = agent.theta + m.angle
        ex = agent.x + m.distance * math.cos(wa)
        ey = agent.y + m.distance * math.sin(wa)
        pygame.draw.line(screen, RAY, (ax, ay), view.w2s(ex, ey), 1)


def draw_loop_closure_ring(screen, view: View, agent) -> None:
    cx, cy = view.w2s(agent.x, agent.y)
    pygame.draw.circle(screen, GOLD, (cx, cy), int(0.40 * view.scale), 2)


def draw_viewer_ring(screen, view: View, agent) -> None:
    cx, cy = view.w2s(agent.x, agent.y)
    pygame.draw.circle(screen, GOLD, (cx, cy), int(0.55 * view.scale), 1)


def draw_beacon_cone(screen, view: View, agent, range_m: float) -> None:
    """Translucent disc marking the viewer's beacon range. Peers inside this
    disc are eligible to gain self-anchored presence; peers outside rely on
    sticky existence or one-hop transitive presence."""
    cx, cy = view.w2s(agent.x, agent.y)
    r = int(range_m * view.scale)
    if r <= 0:
        return
    surf = pygame.Surface((r * 2, r * 2), pygame.SRCALPHA)
    pygame.draw.circle(surf, (*GOLD, 18), (r, r), r)
    pygame.draw.circle(surf, (*GOLD, 90), (r, r), r, 1)
    screen.blit(surf, (cx - r, cy - r))


def draw_target_caret(screen, view: View, agent) -> None:
    cx, cy = view.w2s(agent.x, agent.y)
    r = int(0.65 * view.scale)
    pygame.draw.circle(screen, ALERT, (cx, cy), r, 1)
    pygame.draw.line(screen, ALERT, (cx - r - 4, cy), (cx - r + 2, cy), 1)
    pygame.draw.line(screen, ALERT, (cx + r - 2, cy), (cx + r + 4, cy), 1)


def draw_skew_badge(screen, font, view: View, agent) -> None:
    cx, cy = view.w2s(agent.x, agent.y)
    pygame.draw.circle(screen, SKEW_BLUE, (cx + 14, cy - 14), 7, 1)
    pygame.draw.line(screen, SKEW_BLUE, (cx + 14, cy - 14), (cx + 14, cy - 19), 1)
    pygame.draw.line(screen, SKEW_BLUE, (cx + 14, cy - 14), (cx + 18, cy - 14), 1)


def draw_lying_badge(screen, view: View, agent) -> None:
    cx, cy = view.w2s(agent.x, agent.y)
    pygame.draw.line(screen, ALERT, (cx - 6, cy - 18), (cx + 6, cy - 6), 2)
    pygame.draw.line(screen, ALERT, (cx + 6, cy - 18), (cx - 6, cy - 6), 2)


def draw_sybil(screen, view: View, x: float, y: float, *, struck: bool = False) -> None:
    """Sybil glyph at its *claimed* fake position. `struck` overlays a red X
    when the sybil has just been rejected (e.g., unattested_key)."""
    cx, cy = view.w2s(x, y)
    r = int(0.30 * view.scale)
    pygame.draw.circle(screen, SYBIL_GRAY, (cx, cy), r, 1)
    for dx, dy in ((-r, 0), (r, 0), (0, -r), (0, r)):
        pygame.draw.line(screen, SYBIL_GRAY,
                         (cx + dx - 2, cy + dy), (cx + dx + 2, cy + dy), 1)
    label = small_font_cache.get()
    if label is not None:
        screen.blit(label.render("S", True, SYBIL_GRAY), (cx - 3, cy - 6))
    if struck:
        pygame.draw.line(screen, ALERT, (cx - r, cy - r), (cx + r, cy + r), 2)
        pygame.draw.line(screen, ALERT, (cx + r, cy - r), (cx - r, cy + r), 2)


class _SmallFontCache:
    """Lazy holder for a small font used inside helpers (avoids re-creating
    the SysFont each frame and avoids passing it through long signatures)."""

    def __init__(self) -> None:
        self._font = None

    def get(self):  # type: ignore[no-untyped-def]
        if self._font is None and pygame.font.get_init():
            self._font = pygame.font.SysFont("Menlo,Monaco,Courier", 9, bold=True)
        return self._font


small_font_cache = _SmallFontCache()


def draw_sybil_tether(screen, view: View, claim_x: float, claim_y: float,
                      target_x: float, target_y: float) -> None:
    """Dashed line from a sybil's claimed position back to the target it's
    corroborating. Makes the false-witness relationship explicit."""
    a = view.w2s(claim_x, claim_y)
    b = view.w2s(target_x, target_y)
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = max(1.0, math.hypot(dx, dy))
    step_px = 6
    n_steps = int(length // step_px)
    for k in range(0, n_steps, 2):
        t0 = k / n_steps
        t1 = min(1.0, (k + 1) / n_steps)
        p0 = (a[0] + int(dx * t0), a[1] + int(dy * t0))
        p1 = (a[0] + int(dx * t1), a[1] + int(dy * t1))
        pygame.draw.line(screen, SYBIL_GRAY, p0, p1, 1)


def draw_lie_claim(screen, view: View, real_x: float, real_y: float,
                    claim_x: float, claim_y: float, theta: float, *,
                    struck: bool = False) -> None:
    """Red dashed claim-triangle at the lied position + arrow from real → claim.
    Under range-only voting (ADR 0015) `pose_lie` alone is a trust-layer
    no-op; `struck` now reflects map-merger anomaly flagging instead."""
    pts = agent_triangle_pts(view, claim_x, claim_y, theta)
    pygame.draw.polygon(screen, CLAIM_RED, pts, 1)
    a = view.w2s(real_x, real_y)
    b = view.w2s(claim_x, claim_y)
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = max(1.0, math.hypot(dx, dy))
    step_px = 6
    n_steps = max(2, int(length // step_px))
    for k in range(0, n_steps, 2):
        t0 = k / n_steps
        t1 = min(1.0, (k + 1) / n_steps)
        p0 = (a[0] + int(dx * t0), a[1] + int(dy * t0))
        p1 = (a[0] + int(dx * t1), a[1] + int(dy * t1))
        pygame.draw.line(screen, CLAIM_RED, p0, p1, 1)
    # Arrowhead
    angle = math.atan2(dy, dx)
    head_len = 8
    hp1 = (b[0] - int(head_len * math.cos(angle - 0.5)),
           b[1] - int(head_len * math.sin(angle - 0.5)))
    hp2 = (b[0] - int(head_len * math.cos(angle + 0.5)),
           b[1] - int(head_len * math.sin(angle + 0.5)))
    pygame.draw.line(screen, CLAIM_RED, b, hp1, 1)
    pygame.draw.line(screen, CLAIM_RED, b, hp2, 1)
    if struck:
        cx, cy = b
        r = int(0.35 * view.scale)
        pygame.draw.line(screen, ALERT, (cx - r, cy - r), (cx + r, cy + r), 2)
        pygame.draw.line(screen, ALERT, (cx + r, cy - r), (cx - r, cy + r), 2)


def draw_rejection_tracer(screen, view: View, x: float, y: float, fade: float) -> None:
    """Red ✗ puff at a sender that just had an envelope rejected. `fade` ∈ [0,1]."""
    cx, cy = view.w2s(x, y)
    r = max(4, int(0.18 * view.scale))
    alpha = max(40, int(220 * fade))
    surf = pygame.Surface((r * 2 + 4, r * 2 + 4), pygame.SRCALPHA)
    pygame.draw.line(surf, (*ALERT, alpha),
                     (2, 2), (r * 2 + 2, r * 2 + 2), 2)
    pygame.draw.line(surf, (*ALERT, alpha),
                     (r * 2 + 2, 2), (2, r * 2 + 2), 2)
    screen.blit(surf, (cx - r - 2, cy - r - 2))


def make_legend_glyph_drawer():
    """Return a callable that paints small legend icons at (cx, cy)."""

    def paint(screen, kind: str, cx: int, cy: int) -> None:
        if kind == "honest":
            pygame.draw.polygon(screen, AGENT,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)])
        elif kind == "compromised":
            pygame.draw.polygon(screen, AGENT_BAD,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)])
        elif kind == "lying":
            pygame.draw.polygon(screen, AGENT,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)])
            pygame.draw.line(screen, ALERT, (cx - 4, cy - 5), (cx + 7, cy + 5), 2)
            pygame.draw.line(screen, ALERT, (cx + 7, cy - 5), (cx - 4, cy + 5), 2)
        elif kind == "revoked":
            pygame.draw.polygon(screen, REVOKED,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)])
            pygame.draw.polygon(screen, ALERT,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)], 1)
        elif kind == "skewed":
            pygame.draw.polygon(screen, AGENT,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)])
            pygame.draw.circle(screen, SKEW_BLUE, (cx + 11, cy - 6), 4, 1)
        elif kind == "sybil":
            pygame.draw.circle(screen, SYBIL_GRAY, (cx + 2, cy), 6, 1)
        elif kind == "claim":
            pygame.draw.polygon(screen, CLAIM_RED,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)], 1)
            pygame.draw.line(screen, CLAIM_RED, (cx - 8, cy - 6), (cx - 4, cy - 5), 1)
        elif kind == "tracer":
            pygame.draw.line(screen, ALERT, (cx - 4, cy - 4), (cx + 4, cy + 4), 2)
            pygame.draw.line(screen, ALERT, (cx + 4, cy - 4), (cx - 4, cy + 4), 2)
        elif kind == "ghost":
            pygame.draw.polygon(screen, GHOST,
                                [(cx + 7, cy), (cx - 4, cy - 5), (cx - 4, cy + 5)], 1)
        elif kind == "loop":
            pygame.draw.circle(screen, GOLD, (cx + 2, cy), 7, 1)
        elif kind == "wall_low":
            pygame.draw.rect(screen, CONFIDENCE_LOW, (cx - 4, cy - 3, 12, 6))
        elif kind == "wall_mid":
            pygame.draw.rect(screen, CONFIDENCE_MID, (cx - 4, cy - 3, 12, 6))
        elif kind == "wall_high":
            pygame.draw.rect(screen, CONFIDENCE_HIGH, (cx - 4, cy - 3, 12, 6))

    return paint


# =============================================================================
# Right-pane reputation bars
# =============================================================================


def draw_reputation_block(
    screen, font, bold, x: int, y: int, w: int,
    state, snap: RenderSnapshot,
) -> int:
    """Per-peer row: pip, name, presence badge (✓/✗), stacked α/β bar, score.
    Presence ≠ reputation: ✓ means self has personally beaconed (or transitively
    trusts) this peer; the bar shows accumulated α (green) vs β (red) evidence."""
    screen.blit(bold.render(f"REPUTATION  (viewer = {state.viewer_id})", True, GOLD), (x, y))
    y += 18
    label_w = 90
    badge_w = 14
    value_w = 38
    bar_x = x + label_w + badge_w
    bar_w = max(40, w - label_w - badge_w - value_w - 8)
    val_x = bar_x + bar_w + 6
    for a in state.sim.agents:
        is_self = a.id == state.viewer_id
        bad = a.id in snap.bad_agents or a.id in snap.lying_agents
        pip_color = AGENT_BAD if bad else AGENT
        pygame.draw.rect(screen, pip_color, (x, y + 3, 8, 8))
        label = f"{a.id}{' (self)' if is_self else ''}"
        screen.blit(font.render(label[:14], True, INK), (x + 14, y))
        present = is_self or snap.viewer_presence.get(a.id, False)
        badge = "✓" if present else "✗"
        badge_color = GREEN if present else INK_DIM
        screen.blit(font.render(badge, True, badge_color), (x + label_w, y))
        rep = snap.viewer_reputation.get(a.id, 0.5)
        if is_self:
            # Self reputation is hard-coded 1.0 in BetaTrustEvaluator.reputation();
            # the underlying _peers["self"] counters accumulate residue but aren't
            # consulted, so showing a stacked α/β bar here would be misleading.
            screen.blit(font.render("— self —", True, INK_DIM), (bar_x, y))
        else:
            alpha, beta = snap.viewer_alpha_beta.get(a.id, (1.0, 1.0))
            total = max(1e-6, alpha + beta)
            a_w = max(0, min(bar_w, int(bar_w * alpha / total)))
            b_w = max(0, bar_w - a_w)
            pygame.draw.rect(screen, DIVIDER, (bar_x, y + 4, bar_w, 6))
            pygame.draw.rect(screen, GREEN, (bar_x, y + 4, a_w, 6))
            pygame.draw.rect(screen, ALERT, (bar_x + a_w, y + 4, b_w, 6))
        screen.blit(font.render(f"{rep:.2f}", True, INK_DIM), (val_x, y))
        y += 16
    pygame.draw.line(screen, DIVIDER, (x, y + 4), (x + w, y + 4), 1)
    return y + 12


def draw_envelope_log(screen, font, x: int, y: int, w: int, h: int, log) -> None:
    """Collapsed envelope log — `(verdict, sender)` deduped with `× N`,
    most-recent group first. Spam from a single attack collapses into one
    counted row instead of scrolling past."""
    line_h = 14
    max_lines = max(0, h // line_h)
    palette = {
        "ok": (GREEN, "+ {s:<10} accepted"),
        "lie": (GOLD, "! {s:<10} pose-lying"),
        "heal": (GREEN, "~ {s:<10} healed"),
        "compro": (GOLD, "! {s:<10} key swapped"),
        "revoke": (ALERT, "# {s:<10} key REVOKED"),
        "rotate": (GOLD, "@ {s:<10} key rotated"),
        "sybil": (ALERT, "S {s:<10} sybil minted"),
        "attest": (GOLD, "A attestation = {s}"),
        "skew": (GOLD, "K {s:<10} +6s clock skew"),
        "unskew": (GREEN, "K {s:<10} skew cleared"),
        "rec": (GREEN, "J telemetry → jsonl ON"),
        "rec-stop": (INK_DIM, "J telemetry recording stopped"),
    }
    groups: dict[tuple[str, str], tuple[int, str, str]] = {}
    for verdict, sender, _nonce in log:
        key = (verdict, sender)
        prev = groups.get(key)
        count = (prev[0] if prev else 0) + 1
        groups.pop(key, None)
        groups[key] = (count, verdict, sender)
    items = list(groups.values())
    items.reverse()
    for count, verdict, sender in items[:max_lines]:
        if verdict.startswith("reject:"):
            cat = verdict.split(":", 1)[1]
            color = (ALERT if cat in ALERT_CATEGORIES
                     else GOLD if cat in GOLD_CATEGORIES else INK_DIM)
            line = f"x {sender[:10]:<10} {cat}"
        else:
            color, fmt = palette.get(verdict, (INK_DIM, "? {s}"))
            line = fmt.format(s=sender[:10])
        if count > 1:
            line += f"  × {count}"
        screen.blit(font.render(line, True, color), (x, y))
        y += line_h


# =============================================================================
# History panel (action log + reset button)
# =============================================================================


# Pretty labels for the action history. Keys match `apply_attack` `kind` values.
ACTION_LABELS = {
    "swap_key": ("compromise", AGENT_BAD),
    "pose_lie": ("pose-lie", GOLD),
    "heal": ("heal", GREEN),
    "revoke": ("revoke key", ALERT),
    "rotate": ("rotate key", GOLD),
    "sybil": ("mint sybil", ALERT),
    "toggle_attestation": ("toggle attest", GOLD),
    "skew": ("clock skew ±6s", GOLD),
    "toggle_jsonl": ("telemetry rec", INK_DIM),
    "reset": ("RESET", GREEN),
    "tour": ("guided tour", GOLD),
}


def draw_history_panel(
    screen, font, bold,
    x: int, y: int, w: int, h: int,
    history: list[tuple[float, str, str]],
) -> pygame.Rect:
    """History strip under the canvas. Shows action log (most recent first)
    and a clickable RESET button. Returns the reset button's hit rect."""
    pygame.draw.rect(screen, PANEL, (x, y, w, h))
    pygame.draw.line(screen, DIVIDER, (x, y), (x + w, y), 1)
    header_y = y + 8
    screen.blit(bold.render("HISTORY", True, GOLD), (x + 12, header_y))
    # Reset button — top-right of the strip.
    btn_w, btn_h = 92, 22
    btn_x = x + w - btn_w - 12
    btn_y = header_y - 4
    reset_rect = pygame.Rect(btn_x, btn_y, btn_w, btn_h)
    pygame.draw.rect(screen, BG, reset_rect)
    pygame.draw.rect(screen, GREEN, reset_rect, 1)
    label_surf = bold.render("RESET (⌫)", True, GREEN)
    screen.blit(label_surf,
                (btn_x + (btn_w - label_surf.get_width()) // 2,
                 btn_y + (btn_h - label_surf.get_height()) // 2))
    # Rows: most recent first.
    list_y = header_y + 22
    line_h = 14
    max_lines = max(0, (h - (list_y - y) - 8) // line_h)
    if not history:
        screen.blit(font.render("(no actions yet — try X/L/R/T/Y/A/K or RESET)",
                                True, INK_DIM), (x + 12, list_y))
        return reset_rect
    for sim_t, kind, target in reversed(history[-max_lines:]):
        label, color = ACTION_LABELS.get(kind, (kind, INK_DIM))
        tgt = target or "—"
        line = f"t={sim_t:6.2f}s   {label:<14}  ←  {tgt}"
        screen.blit(font.render(line, True, color), (x + 12, list_y))
        list_y += line_h
    return reset_rect


# =============================================================================
# Keymap groups (for F1 cheatsheet)
# =============================================================================


KEYMAP_GROUPS = [
    ("─ view / sim ─", [
        ("SPACE", "pause / resume"),
        ("N", "single-step"),
        ("V", "cycle viewer"),
        ("0–9", "pick target agent"),
        ("[ / ]", "sim speed −/+"),
        ("− / +", "zoom −/+"),
        ("F", "fullscreen"),
        ("G", "guided tour"),
        ("⌫", "reset swarm"),
        ("Q", "quit"),
    ]),
    ("─ Byzantine attacks ─", [
        ("X", "swap key → bad_signature"),
        ("L", "pose-lie → geometric"),
        ("H", "heal liar"),
    ]),
    ("─ identity hardening ─", [
        ("R", "revoke key"),
        ("T", "rotate key + announce"),
        ("Y", "mint sybil"),
        ("A", "toggle attestation"),
        ("K", "toggle +6s skew"),
    ]),
    ("─ telemetry ─", [
        ("J", "tee → jsonl"),
    ]),
]

KEY_TO_ATTACK = {
    pygame.K_x: "swap_key",
    pygame.K_l: "pose_lie",
    pygame.K_h: "heal",
    pygame.K_r: "revoke",
    pygame.K_t: "rotate",
    pygame.K_y: "sybil",
    pygame.K_a: "toggle_attestation",
    pygame.K_k: "skew",
    pygame.K_j: "toggle_jsonl",
}


def toast_for(kind: str, target: str | None, result: str) -> str:
    descriptions = {
        "swap_key": "key swapped — every emit now fails bad_signature",
        "pose_lie": "pose-lying — trust no-op under range-only voting; merger flags fragment",
        "heal": "honest publishing resumed — reputation rebuilds via decay",
        "revoke": "pubkey on revocation list — envelopes rejected key_revoked",
        "rotate": "key rotated + announced — old envelopes → key_revoked_post_rotation",
        "sybil": "sybil minted — A toggles to flip it to unattested_key",
        "toggle_attestation": f"attestation required = {result}",
        "skew": "clock skew applied/cleared — clock_skew_future on excess",
        "toggle_jsonl": "telemetry recording toggled",
    }
    head = descriptions.get(kind, kind)
    if target and kind not in {"toggle_attestation", "toggle_jsonl"}:
        return f"{kind.upper()} on {target}  ·  {head}"
    return f"{kind.upper()}  ·  {head}"


# =============================================================================
# MAIN
# =============================================================================


def main() -> None:
    args = parse_args()
    state = build_swarm(args.scenario, args.bus)

    pygame.init()
    flags = pygame.RESIZABLE | (pygame.FULLSCREEN if args.fullscreen else 0)
    screen = pygame.display.set_mode((args.width, args.height), flags)
    pygame.display.set_caption("SPECTER-1 // unified demo")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("Menlo,Monaco,Courier", 12)
    small = pygame.font.SysFont("Menlo,Monaco,Courier", 11)
    bold = pygame.font.SysFont("Menlo,Monaco,Courier", 13, bold=True)
    title_font = pygame.font.SysFont("Menlo,Monaco,Courier", 14, bold=True)

    view = View(state.sim.world.width, state.sim.world.height)
    legend_glyph = make_legend_glyph_drawer()

    paused = False
    step_once = False
    fullscreen = args.fullscreen
    speed_mult = 1.0
    base_fps = max(1, int(round(1.0 / state.sim.dt)))
    use_cadences = args.cadences

    target_idx: int | None = None  # None = auto-pick (legacy behavior)
    toast_text = ""
    toast_until = 0.0

    while True:
        win_w, win_h = screen.get_size()

        # Layout regions
        world_x = 0
        state_x = win_w - STATE_W - STREAM_W
        stream_x = win_w - STREAM_W
        canvas_w = max(200, state_x - world_x)
        canvas_h = max(200, win_h - STATUS_H - HISTORY_H)
        history_y = canvas_h
        view.fit(world_x, 0, canvas_w, canvas_h)
        reset_rect: pygame.Rect | None = None

        # ── EVENTS ─────────────────────────────────────────────────────
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                pygame.quit()
                return
            if ev.type == pygame.VIDEORESIZE and not fullscreen:
                screen = pygame.display.set_mode((ev.w, ev.h), pygame.RESIZABLE)
            if ev.type == pygame.MOUSEBUTTONDOWN and ev.button == 1:
                if reset_rect is not None and reset_rect.collidepoint(ev.pos):
                    prior_history = list(state.action_history)
                    state = build_swarm(args.scenario, args.bus)
                    state.action_history = prior_history
                    state.action_history.append((state.sim.t, "reset", "swarm"))
                    view = View(state.sim.world.width, state.sim.world.height)
                    target_idx = None
                    toast_text = "RESET — fresh swarm"
                    toast_until = time.monotonic() + TOAST_TTL_S
                continue
            if ev.type != pygame.KEYDOWN:
                continue
            k = ev.key
            if k == pygame.K_BACKSPACE:
                prior_history = list(state.action_history)
                state = build_swarm(args.scenario, args.bus)
                state.action_history = prior_history
                state.action_history.append((state.sim.t, "reset", "swarm"))
                view = View(state.sim.world.width, state.sim.world.height)
                target_idx = None
                toast_text = "RESET — fresh swarm"
                toast_until = time.monotonic() + TOAST_TTL_S
                continue
            if k in (pygame.K_q, pygame.K_ESCAPE):
                pygame.quit()
                return
            if k == pygame.K_SPACE:
                paused = not paused
            elif k == pygame.K_n:
                step_once = True
            elif k == pygame.K_v:
                idx = state.agent_ids.index(state.viewer_id)
                state.viewer_id = state.agent_ids[(idx + 1) % len(state.agent_ids)]
            elif k == pygame.K_f:
                fullscreen = not fullscreen
                flags = pygame.RESIZABLE | (pygame.FULLSCREEN if fullscreen else 0)
                size = (0, 0) if fullscreen else (args.width, args.height)
                screen = pygame.display.set_mode(size, flags)
            elif k in (pygame.K_LEFTBRACKET,):
                speed_mult = max(0.1, speed_mult / 1.5)
            elif k in (pygame.K_RIGHTBRACKET,):
                speed_mult = min(8.0, speed_mult * 1.5)
            elif k in (pygame.K_MINUS, pygame.K_KP_MINUS):
                view.zoom = max(0.4, view.zoom / 1.15)
            elif k in (pygame.K_EQUALS, pygame.K_PLUS, pygame.K_KP_PLUS):
                view.zoom = min(4.0, view.zoom * 1.15)
            elif k == pygame.K_g:
                start_tour(state)
                state.action_history.append((state.sim.t, "tour", "all"))
                toast_text = ""  # tour drives its own toast
                toast_until = 0.0
            elif pygame.K_0 <= k <= pygame.K_9:
                idx = k - pygame.K_0
                if idx < len(state.agent_ids):
                    target_idx = idx
                    toast_text = f"target → {state.agent_ids[idx]}"
                    toast_until = time.monotonic() + 1.5
                else:
                    target_idx = None
                    toast_text = "target → auto"
                    toast_until = time.monotonic() + 1.5
            elif k in KEY_TO_ATTACK:
                kind = KEY_TO_ATTACK[k]
                target_id = (state.agent_ids[target_idx]
                             if target_idx is not None and target_idx < len(state.agent_ids)
                             else None)
                applied, label = apply_attack(state, kind, target=target_id)
                if applied:
                    state.action_history.append((state.sim.t, kind, label or target_id or ""))
                    toast_text = toast_for(kind, label or target_id, label)
                    toast_until = time.monotonic() + TOAST_TTL_S

        # ── TICK ADVANCE ───────────────────────────────────────────────
        if not paused or step_once:
            step_once = False
            if use_cadences:
                ticks_per_frame = max(1, int(200 // base_fps * speed_mult))
                for _ in range(ticks_per_frame):
                    nc = state.tick_count + 1
                    step(state,
                         emit_lidar=(nc % LIDAR_STRIDE == 0),
                         emit_gossip=(nc % GOSSIP_STRIDE == 0))
            else:
                ticks_per_frame = max(1, int(round(speed_mult)))
                for _ in range(ticks_per_frame):
                    step(state, emit_lidar=True, emit_gossip=True)

        snap: RenderSnapshot = snapshot(state)

        # ── CLEAR + WORLD CANVAS ───────────────────────────────────────
        screen.fill(BG)
        canvas_rect = (world_x, 0, canvas_w, canvas_h)
        pygame.draw.rect(screen, (14, 17, 13), canvas_rect)

        if state.last_tick is not None:
            # Merged grid heatmap is rendered in world frame; we draw it
            # via a temp surface pinned to the canvas origin.
            _draw_merged_world(screen, view, snap)

        for w in snap.walls:
            pygame.draw.line(screen, WALL,
                             view.w2s(w.x1, w.y1), view.w2s(w.x2, w.y2), 2)

        if state.last_tick is not None:
            target_id = (state.agent_ids[target_idx]
                         if target_idx is not None and target_idx < len(state.agent_ids)
                         else None)
            for agent in snap.agents:
                draw_lidar(screen, view, agent, snap.scans[agent.id])
            for agent in snap.agents:
                p = snap.slam_poses[agent.id]
                draw_ghost(screen, view, p.x, p.y, p.theta)
            # Lie claim ghosts (red dashed triangle at the lied position).
            attest_required_now = state.attestation_required
            for sid in snap.lying_agents:
                p = snap.slam_poses.get(sid)
                if p is None:
                    continue
                claim_x = p.x + LIE_OFFSET[0]
                claim_y = p.y + LIE_OFFSET[1]
                struck = _recently_rejected(snap, sid, state.tick_count)
                draw_lie_claim(screen, view, p.x, p.y, claim_x, claim_y, p.theta,
                               struck=struck)
            # Sybils render at their *claimed* fake pose (most-recent emit)
            # with a dashed tether back to the corroboration target. When
            # attestation is required, the sybil emit is rejected and the
            # glyph gets a red strike-through.
            for sybil_id, real_target in snap.sybil_targets.items():
                claim = snap.sybil_claim_pose.get(sybil_id)
                target_agent = next((a for a in snap.agents if a.id == real_target), None)
                if claim is None or target_agent is None:
                    continue
                claim_x, claim_y = claim
                struck = attest_required_now or _recently_rejected(
                    snap, sybil_id, state.tick_count)
                draw_sybil(screen, view, claim_x, claim_y, struck=struck)
                draw_sybil_tether(screen, view,
                                  claim_x, claim_y, target_agent.x, target_agent.y)
            # Rejection tracers — visible red ✗ on senders whose envelope
            # was thrown out within the last few ticks. Sustained for
            # swap-key / revoke / skew attacks; flickers for lie-rejections.
            for sid, last_tick in snap.last_reject_tick.items():
                age = state.tick_count - last_tick
                if 0 <= age < TRACER_TTL_TICKS:
                    fade = 1.0 - (age / TRACER_TTL_TICKS)
                    src_agent = next((a for a in snap.agents if a.id == sid), None)
                    if src_agent is not None:
                        draw_rejection_tracer(screen, view,
                                              src_agent.x, src_agent.y, fade)
                    else:
                        # Sybil sender — no body. Draw at claim pose if known.
                        sybil_claim = snap.sybil_claim_pose.get(sid)
                        if sybil_claim is not None:
                            draw_rejection_tracer(screen, view,
                                                  sybil_claim[0], sybil_claim[1], fade)
            for agent in snap.agents:
                if agent.id == state.viewer_id:
                    draw_beacon_cone(screen, view, agent, BEACON_MAX_RANGE_M)
                color, dashed = _agent_color(agent.id, state, snap)
                draw_agent(screen, view, agent, color=color, dashed=dashed)
                if agent.id in state.liars:
                    draw_lying_badge(screen, view, agent)
                if agent.id in state.clock_skew_offsets:
                    draw_skew_badge(screen, font, view, agent)
                if agent.id == state.viewer_id:
                    draw_viewer_ring(screen, view, agent)
                    if snap.loop_closure_active:
                        draw_loop_closure_ring(screen, view, agent)
                if agent.id == target_id:
                    draw_target_caret(screen, view, agent)
                ax, ay = view.w2s(agent.x, agent.y)
                drift = snap.slam_drift[agent.id]
                lab_color = AGENT_BAD if (agent.id in snap.bad_agents
                                           or agent.id in snap.lying_agents) else INK
                tag = " ◀VIEW" if agent.id == state.viewer_id else ""
                screen.blit(font.render(f"{agent.id}{tag}  Δ{drift:.2f}m", True, lab_color),
                            (ax + 10, ay + 8))
            if state.loop_closure_flash[state.viewer_id] > 0:
                state.loop_closure_flash[state.viewer_id] -= 1

        # ── HISTORY PANEL (under canvas, with RESET button) ────────────
        reset_rect = draw_history_panel(
            screen, font, bold,
            world_x, history_y, canvas_w, HISTORY_H,
            state.action_history,
        )

        # ── STATE COLUMN ───────────────────────────────────────────────
        pygame.draw.rect(screen, PANEL, (state_x, 0, STATE_W, win_h - STATUS_H))
        pygame.draw.line(screen, DIVIDER, (state_x, 0), (state_x, win_h - STATUS_H), 1)
        sx = state_x + 14
        sw = STATE_W - 28
        sy = PADDING

        screen.blit(title_font.render("SPECTER-1", True, GOLD), (sx, sy))
        sy += 22
        sy = draw_legend(screen, font, bold, sx, sy, sw, glyph_drawer=legend_glyph)
        sy = draw_state_panel(
            screen, font, bold, sx, sy, sw,
            _state_fields(state, snap, view, speed_mult, use_cadences, target_idx),
        )
        sy = draw_keymap_panel(screen, font, bold, sx, sy, sw, KEYMAP_GROUPS)

        # ── EVENT STREAM COLUMN ────────────────────────────────────────
        pygame.draw.rect(screen, PANEL, (stream_x, 0, STREAM_W, win_h - STATUS_H))
        pygame.draw.line(screen, DIVIDER, (stream_x, 0), (stream_x, win_h - STATUS_H), 1)
        ex = stream_x + 14
        ew = STREAM_W - 28
        ey = PADDING

        ey = draw_reputation_block(screen, font, bold, ex, ey, ew, state, snap)

        peers_for_history = [a.id for a in state.sim.agents if a.id != state.viewer_id]
        screen.blit(bold.render("REPUTATION  (10s)", True, GOLD), (ex, ey))
        ey += 18
        draw_history_overlay(
            screen, state.rep_traces[state.viewer_id], peers_for_history,
            int(state.sim.t * 1e9), (ex, ey), font,
        )
        ey += HIST_H + 12
        pygame.draw.line(screen, DIVIDER, (ex, ey - 4), (ex + ew, ey - 4), 1)

        ey = draw_anomaly_stream(screen, font, bold, small,
                                 state.telemetry, ex, ey, ew)
        ey += 6
        pygame.draw.line(screen, DIVIDER, (ex, ey), (ex + ew, ey), 1)
        ey += 8
        screen.blit(bold.render("ENVELOPE LOG", True, GOLD), (ex, ey))
        ey += 18
        draw_envelope_log(screen, font, ex, ey, ew,
                         (win_h - STATUS_H) - ey - 8, state.log)

        # ── STATUS BAR ─────────────────────────────────────────────────
        _draw_status_bar(screen, font, win_w, win_h, state, paused,
                        speed_mult, view.zoom, use_cadences, target_idx)

        # ── TOAST ──────────────────────────────────────────────────────
        # Tour narration (state-driven) takes precedence over keypress toasts.
        if snap.tour_toast:
            draw_toast(screen, font, bold, canvas_w, snap.tour_toast, 1.0)
        else:
            now = time.monotonic()
            if now < toast_until:
                fade = max(0.0, min(1.0, (toast_until - now) / TOAST_TTL_S))
                draw_toast(screen, font, bold, canvas_w, toast_text, fade)

        pygame.display.flip()
        clock.tick(base_fps)
        if args.max_ticks is not None and state.tick_count >= args.max_ticks:
            pygame.quit()
            return


# =============================================================================
# Helpers
# =============================================================================


def _agent_color(agent_id: str, state, snap: RenderSnapshot) -> tuple[tuple[int, int, int], bool]:
    if agent_id in snap.bad_agents:
        return AGENT_BAD, False
    if agent_id in snap.lying_agents:
        return AGENT, False  # honest key, badge drawn separately
    return AGENT, False


def _draw_merged_world(screen, view: View, snap: RenderSnapshot) -> None:
    """Render the merged occupancy grid using the runtime view scale.

    Cells are colored by occupied-vote weight as a confidence proxy:
      tier 0 (single observer)        → CONFIDENCE_LOW, alpha 60
      tier 1 (≥2 corroborating)        → CONFIDENCE_MID, alpha 90
      tier 2 (≥6 well-confirmed)       → CONFIDENCE_HIGH, alpha 130
    `merged_votes` is the per-cell occ-vote grid from the merger; absence
    falls back to a flat dim overlay (same as the previous behavior)."""
    if snap.merged_grid_bytes is None:
        return
    import json
    grid = json.loads(snap.merged_grid_bytes)
    res = float(grid["resolution"])
    cells = grid["cells"]
    votes = snap.merged_votes
    cell_px = max(1, int(res * view.scale))
    tiers = [
        (CONFIDENCE_LOW, 60),
        (CONFIDENCE_MID, 90),
        (CONFIDENCE_HIGH, 130),
    ]
    surfaces = [pygame.Surface((cell_px, cell_px), pygame.SRCALPHA) for _ in tiers]
    for surf, (color, alpha) in zip(surfaces, tiers, strict=True):
        surf.fill((*color, alpha))
    nx = len(cells)
    for i in range(nx):
        col = cells[i]
        ny = len(col)
        for j in range(ny):
            if not col[j]:
                continue
            tier_idx = 0
            if votes is not None and i < len(votes) and j < len(votes[i]):
                v = votes[i][j]
                if v >= 6.0:
                    tier_idx = 2
                elif v >= 2.0:
                    tier_idx = 1
            screen.blit(surfaces[tier_idx], view.w2s(i * res, (j + 1) * res))


def _recently_rejected(snap: RenderSnapshot, sender_id: str, now_tick: int) -> bool:
    last = snap.last_reject_tick.get(sender_id)
    if last is None:
        return False
    return 0 <= (now_tick - last) < TRACER_TTL_TICKS


def _state_fields(state, snap, view: View, speed: float, cad: bool,
                  target_idx: int | None) -> list[tuple[str, str, tuple[int, int, int]]]:
    target_label = (state.agent_ids[target_idx]
                    if target_idx is not None and target_idx < len(state.agent_ids)
                    else "auto (first match)")
    sybil_str = (", ".join(f"{s}→{t}" for s, t in state.sybil_targets.items())
                 if state.sybil_targets else "—")
    skew_str = (", ".join(state.clock_skew_offsets) if state.clock_skew_offsets else "—")
    revoked_n = len(state.revocation._revoked)  # noqa: SLF001
    return [
        ("viewer", state.viewer_id, GOLD),
        ("target", target_label, ALERT if target_idx is not None else INK_DIM),
        ("bus", state.bus_label[:28], INK),
        ("tick", f"{state.tick_count}", INK),
        ("sim t", f"{state.sim.t:.2f}s", INK),
        ("merge age", f"{state.tick_count - state.last_merge_tick} ticks", INK),
        ("speed", f"{speed:.2f}×{'  CAD' if cad else ''}", INK),
        ("zoom", f"{view.zoom:.2f}×", INK),
        ("attestation", "REQUIRED" if state.attestation_required else "off",
         GOLD if state.attestation_required else INK_DIM),
        ("recording", "ON (jsonl)" if state.telemetry.jsonl is not None else "off",
         GREEN if state.telemetry.jsonl is not None else INK_DIM),
        ("compromised", f"{len(state.compromised)}: {', '.join(state.compromised) or '—'}",
         ALERT if state.compromised else INK_DIM),
        ("liars", f"{len(state.liars)}: {', '.join(state.liars) or '—'}",
         ALERT if state.liars else INK_DIM),
        ("revoked keys", f"{revoked_n}",
         ALERT if revoked_n else INK_DIM),
        ("sybils", sybil_str,
         ALERT if state.sybils else INK_DIM),
        ("skewed", skew_str,
         GOLD if state.clock_skew_offsets else INK_DIM),
    ]


def _draw_status_bar(screen, font, win_w: int, win_h: int, state, paused: bool,
                    speed: float, zoom: float, cad: bool,
                    target_idx: int | None) -> None:
    y = win_h - STATUS_H
    pygame.draw.rect(screen, PANEL, (0, y, win_w, STATUS_H))
    pygame.draw.line(screen, DIVIDER, (0, y), (win_w, y), 1)
    flag = "PAUSED" if paused else "RUNNING"
    flag_color = ALERT if paused else GREEN
    target_label = (state.agent_ids[target_idx]
                    if target_idx is not None and target_idx < len(state.agent_ids)
                    else "auto")
    line = (f"tick={state.tick_count:<6} t={state.sim.t:6.2f}s  "
            f"viewer={state.viewer_id}  target={target_label}  "
            f"speed={speed:.2f}× zoom={zoom:.2f}×  "
            f"bus={state.bus_label[:24]}  {'CAD' if cad else ''}")
    screen.blit(font.render(line, True, INK_DIM), (PADDING, y + 8))
    flag_surf = font.render(flag, True, flag_color)
    screen.blit(flag_surf, (win_w - PADDING - flag_surf.get_width(), y + 8))


if __name__ == "__main__":
    main()
