"""Anomaly stream renderers (compact panel + verbose stream)."""

from __future__ import annotations

from specter.demo.orchestration import StreamTelemetry

from .style import (
    ALERT,
    ALERT_CATEGORIES,
    CATEGORY_DESCRIPTIONS,
    GOLD,
    GOLD_CATEGORIES,
    INK_DIM,
)


def draw_anomaly_panel(
    screen,
    font,
    bold,
    telemetry: StreamTelemetry,
    x: int,
    y: int,
    w: int,
) -> int:
    """Recent anomaly ring → text panel; returns the next y cursor."""
    screen.blit(bold.render("ANOMALIES", True, GOLD), (x, y))
    y += 16
    if not telemetry.recent:
        screen.blit(font.render("(none)", True, INK_DIM), (x, y))
        return y + 14
    for ev in list(telemetry.recent):
        cat = ev.category
        color = ALERT if cat in ALERT_CATEGORIES else (GOLD if cat in GOLD_CATEGORIES else INK_DIM)
        line = f"{cat[:18]:<18} {ev.sender_id[:8]:<8} t={ev.timestamp_ns / 1e9:6.2f}s"
        screen.blit(font.render(line, True, color), (x, y))
        y += 14
    return y


def draw_anomaly_stream(
    screen,
    font,
    bold,
    small,
    telemetry: StreamTelemetry,
    x: int,
    y: int,
    w: int,
) -> int:
    """Collapsed anomaly stream — `(category, sender)` deduped with `× N`
    counters; recency order (most recently fired first). Each entry shows
    category, sender, time, and a plain-English subtitle. Returns the
    next y cursor."""
    screen.blit(bold.render("ANOMALIES", True, GOLD), (x, y))
    y += 18
    if not telemetry.collapsed:
        screen.blit(font.render("(none — bus is clean)", True, INK_DIM), (x, y))
        return y + 14
    char_w = small.size("M")[0] or 7
    sub_max = max(20, (w - 16) // char_w)
    items = list(telemetry.collapsed.values())
    items.reverse()
    for ev, count in items:
        cat = ev.category
        color = ALERT if cat in ALERT_CATEGORIES else (GOLD if cat in GOLD_CATEGORIES else INK_DIM)
        n_str = f"  × {count}" if count > 1 else ""
        head = f"{cat}  ←  {ev.sender_id}  t={ev.timestamp_ns / 1e9:6.2f}s{n_str}"
        screen.blit(font.render(head, True, color), (x, y))
        y += 13
        sub = CATEGORY_DESCRIPTIONS.get(cat, ev.detail or "(no description)")
        if len(sub) > sub_max:
            sub = sub[: sub_max - 1] + "…"
        screen.blit(small.render(f"  {sub}", True, INK_DIM), (x, y))
        y += 14
    return y
