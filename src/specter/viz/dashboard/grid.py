"""Translucent occupancy-grid heatmap."""

from __future__ import annotations

import json

import pygame

from .style import INK_DIM, SCALE, to_screen


def draw_merged_grid(
    screen,
    merged_bytes: bytes | None,
    world_h: float,
    alpha: int = 70,
) -> None:
    """Translucent heatmap of occupied cells from a merged occupancy fragment."""
    if merged_bytes is None:
        return
    grid = json.loads(merged_bytes)
    res = float(grid["resolution"])
    cells = grid["cells"]
    cell_px = max(1, int(res * SCALE))
    surf = pygame.Surface((cell_px, cell_px), pygame.SRCALPHA)
    surf.fill((*INK_DIM, alpha))
    nx = len(cells)
    for i in range(nx):
        col = cells[i]
        ny = len(col)
        for j in range(ny):
            if not col[j]:
                continue
            screen.blit(surf, to_screen(i * res, (j + 1) * res, world_h))
