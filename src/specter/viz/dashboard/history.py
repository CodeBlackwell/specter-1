"""Per-peer reputation sparkline."""

from __future__ import annotations

import pygame

from specter.telemetry import ReputationTrace

from .style import (
    DIVIDER,
    HIST_H,
    HIST_W,
    HIST_WINDOW_NS,
    INK_DIM,
    PANEL,
    PEER_COLORS,
)


def draw_history_overlay(
    screen,
    trace: ReputationTrace,
    peers: list[str],
    now_ns: int,
    origin: tuple[int, int],
    font,
) -> None:
    """Sparkline of α/β reputation over the last `HIST_WINDOW_NS` per peer."""
    x0, y0 = origin
    pygame.draw.rect(screen, PANEL, (x0, y0, HIST_W, HIST_H))
    pygame.draw.rect(screen, DIVIDER, (x0, y0, HIST_W, HIST_H), 1)
    screen.blit(font.render("rep history (10s)", True, INK_DIM), (x0 + 6, y0 + 4))
    plot_x = x0 + 6
    plot_y = y0 + 18
    plot_w = HIST_W - 12
    plot_h = HIST_H - 24
    cutoff = now_ns - HIST_WINDOW_NS
    pygame.draw.line(
        screen, DIVIDER,
        (plot_x, plot_y + plot_h // 2),
        (plot_x + plot_w, plot_y + plot_h // 2), 1,
    )
    for idx, peer in enumerate(peers):
        color = PEER_COLORS[idx % len(PEER_COLORS)]
        series = [s for s in trace.series(peer) if s[0] >= cutoff]
        if len(series) < 2:
            continue
        points = []
        for t_ns, alpha, beta in series:
            total = alpha + beta
            rep = (alpha / total) if total > 0 else 0.5
            frac_t = (t_ns - cutoff) / HIST_WINDOW_NS
            px = plot_x + int(frac_t * plot_w)
            py = plot_y + int((1.0 - rep) * plot_h)
            points.append((px, py))
        if len(points) >= 2:
            pygame.draw.lines(screen, color, False, points, 1)
