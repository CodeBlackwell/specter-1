"""Sidebar panels: legend, swarm-state, keymap, toast."""

from __future__ import annotations

import pygame

from .style import DIVIDER, GOLD, INK_DIM, PANEL


def draw_legend(
    screen,
    font,
    bold,
    x: int,
    y: int,
    w: int,
    *,
    glyph_drawer,
) -> int:
    """Static legend: agent-state glyphs and canvas symbols. `glyph_drawer`
    is a callable `(screen, kind, cx, cy)` that paints the small icon — the
    demo provides one because glyphs are sim-aware (triangles, ghosts).
    Returns the next y cursor."""
    screen.blit(bold.render("LEGEND", True, GOLD), (x, y))
    y += 18
    rows = [
        ("honest", "honest agent (live)"),
        ("compromised", "key swap → bad_signature"),
        ("lying", "pose-lying → merger anomaly (trust no-op)"),
        ("claim", "claim ghost → lied position"),
        ("revoked", "key on revocation list"),
        ("skewed", "clock skew → clock_skew_future"),
        ("sybil", "minted identity at fake position"),
        ("tracer", "envelope rejected (recent)"),
        ("ghost", "SLAM estimate vs ground truth"),
        ("loop", "loop closure ring (gold)"),
        ("wall_low", "merged grid · 1 observer"),
        ("wall_mid", "merged grid · 2+ corroborate"),
        ("wall_high", "merged grid · confirmed"),
    ]
    for kind, label in rows:
        glyph_drawer(screen, kind, x + 8, y + 7)
        screen.blit(font.render(label, True, INK_DIM), (x + 24, y))
        y += 16
    pygame.draw.line(screen, DIVIDER, (x, y + 4), (x + w, y + 4), 1)
    return y + 12


def draw_state_panel(
    screen,
    font,
    bold,
    x: int,
    y: int,
    w: int,
    fields: list[tuple[str, str, tuple[int, int, int]]],
) -> int:
    """Two-column key/value list. `fields` is `(label, value, value_color)`."""
    screen.blit(bold.render("SWARM STATE", True, GOLD), (x, y))
    y += 18
    label_x = x + 8
    val_x = x + 110
    for label, value, color in fields:
        screen.blit(font.render(label, True, INK_DIM), (label_x, y))
        screen.blit(font.render(value, True, color), (val_x, y))
        y += 15
    pygame.draw.line(screen, DIVIDER, (x, y + 4), (x + w, y + 4), 1)
    return y + 12


def draw_keymap_panel(
    screen,
    font,
    bold,
    x: int,
    y: int,
    w: int,
    groups: list[tuple[str, list[tuple[str, str]]]],
) -> int:
    """Inline always-visible keymap. Each row: `KEY` (gold) + description.
    Headers separate logical groups (sim / attacks / identity / record)."""
    screen.blit(bold.render("KEYBINDINGS", True, GOLD), (x, y))
    y += 18
    line_h = 14
    for header, rows in groups:
        screen.blit(font.render(header, True, INK_DIM), (x, y))
        y += line_h
        for key, desc in rows:
            screen.blit(font.render(f"{key:<7}", True, GOLD), (x + 4, y))
            screen.blit(font.render(desc, True, (220, 224, 210)), (x + 60, y))
            y += line_h
        y += 2
    pygame.draw.line(screen, DIVIDER, (x, y), (x + w, y), 1)
    return y + 6


def draw_keymap_overlay(
    screen,
    font,
    bold,
    win_w: int,
    win_h: int,
    groups: list[tuple[str, list[tuple[str, str]]]],
) -> None:
    """Modal cheatsheet — translucent panel covering most of the canvas."""
    panel_w = min(720, win_w - 80)
    line_h = 18
    total_lines = sum(1 + len(rows) for _, rows in groups) + len(groups)
    panel_h = 60 + total_lines * line_h
    panel_h = min(panel_h, win_h - 80)
    px = (win_w - panel_w) // 2
    py = (win_h - panel_h) // 2
    overlay = pygame.Surface((win_w, win_h), pygame.SRCALPHA)
    overlay.fill((0, 0, 0, 160))
    screen.blit(overlay, (0, 0))
    pygame.draw.rect(screen, PANEL, (px, py, panel_w, panel_h))
    pygame.draw.rect(screen, GOLD, (px, py, panel_w, panel_h), 1)
    title = bold.render("KEYBINDINGS  (F1 to close)", True, GOLD)
    screen.blit(title, (px + 16, py + 14))
    y = py + 44
    for header, rows in groups:
        screen.blit(bold.render(header, True, INK_DIM), (px + 16, y))
        y += line_h
        for key, desc in rows:
            screen.blit(font.render(f"  {key:<8}", True, GOLD), (px + 24, y))
            screen.blit(font.render(desc, True, (220, 224, 210)), (px + 110, y))
            y += line_h
        y += 4


def draw_toast(
    screen,
    font,
    bold,
    win_w: int,
    text: str,
    fade: float,
) -> None:
    """Top-center transient banner; `fade` ∈ [0,1] (1 = fully visible)."""
    if not text or fade <= 0:
        return
    pad_x, pad_y = 14, 8
    surf = bold.render(text, True, (10, 13, 10))
    bw = surf.get_width() + pad_x * 2
    bh = surf.get_height() + pad_y * 2
    bx = (win_w - bw) // 2
    by = 14
    alpha = int(220 * fade)
    bg = pygame.Surface((bw, bh), pygame.SRCALPHA)
    bg.fill((*GOLD, alpha))
    screen.blit(bg, (bx, by))
    pygame.draw.rect(screen, (10, 13, 10), (bx, by, bw, bh), 1)
    screen.blit(surf, (bx + pad_x, by + pad_y))
