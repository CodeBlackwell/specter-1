"""Shared pygame render helpers for the unified demo + the operator dashboard.

Originally a single module; split into submodules by panel/topic. The flat
re-export surface preserves call sites: `from specter.viz.dashboard import X`.

pygame is an optional dependency (`pip install specter[viz]`); importing
this package without pygame raises `ImportError` at import time.
"""

from .anomaly import draw_anomaly_panel, draw_anomaly_stream
from .grid import draw_merged_grid
from .history import draw_history_overlay
from .panels import (
    draw_keymap_overlay,
    draw_keymap_panel,
    draw_legend,
    draw_state_panel,
    draw_toast,
)
from .style import (
    ALERT,
    ALERT_CATEGORIES,
    CATEGORY_DESCRIPTIONS,
    DIVIDER,
    GOLD,
    GOLD_CATEGORIES,
    HIST_H,
    HIST_W,
    HIST_WINDOW_NS,
    INK_DIM,
    PADDING,
    PANEL,
    PEER_COLORS,
    SCALE,
    to_screen,
    to_screen_scaled,
)

__all__ = [
    "ALERT",
    "ALERT_CATEGORIES",
    "CATEGORY_DESCRIPTIONS",
    "DIVIDER",
    "GOLD",
    "GOLD_CATEGORIES",
    "HIST_H",
    "HIST_W",
    "HIST_WINDOW_NS",
    "INK_DIM",
    "PADDING",
    "PANEL",
    "PEER_COLORS",
    "SCALE",
    "draw_anomaly_panel",
    "draw_anomaly_stream",
    "draw_history_overlay",
    "draw_keymap_overlay",
    "draw_keymap_panel",
    "draw_legend",
    "draw_merged_grid",
    "draw_state_panel",
    "draw_toast",
    "to_screen",
    "to_screen_scaled",
]
