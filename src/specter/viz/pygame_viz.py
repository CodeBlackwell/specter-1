"""Pygame live viewer. Strict Tick consumer — never on the sim critical path.

Keys: SPACE pause, N single-step, S screenshot, Q quit.
"""

import math

import pygame

from ..sim.runner import Simulation, Tick

SCALE = 60  # pixels per meter
PADDING = 24
STATUS_H = 28

BG = (10, 13, 10)
WALL = (212, 216, 200)
RAY = (122, 155, 94)
AGENT = (201, 169, 97)
AGENT_OUTLINE = (10, 13, 10)
INK = (212, 216, 200)
INK_DIM = (138, 143, 125)
ALERT = (212, 88, 58)


def _to_screen(x: float, y: float, world_h: float) -> tuple[int, int]:
    return int(x * SCALE + PADDING), int((world_h - y) * SCALE + PADDING)


def _draw_agent(screen: pygame.Surface, agent, world_h: float) -> None:
    nose = (agent.x + 0.30 * math.cos(agent.theta), agent.y + 0.30 * math.sin(agent.theta))
    left = (agent.x + 0.20 * math.cos(agent.theta + 2.6), agent.y + 0.20 * math.sin(agent.theta + 2.6))
    right = (agent.x + 0.20 * math.cos(agent.theta - 2.6), agent.y + 0.20 * math.sin(agent.theta - 2.6))
    pts = [_to_screen(*nose, world_h), _to_screen(*left, world_h), _to_screen(*right, world_h)]
    pygame.draw.polygon(screen, AGENT, pts)
    pygame.draw.polygon(screen, AGENT_OUTLINE, pts, 1)


def _draw_lidar(screen: pygame.Surface, agent, scans, world_h: float) -> None:
    ax, ay = _to_screen(agent.x, agent.y, world_h)
    for m in scans:
        if math.isinf(m.distance):
            continue
        world_angle = agent.theta + m.angle
        ex = agent.x + m.distance * math.cos(world_angle)
        ey = agent.y + m.distance * math.sin(world_angle)
        pygame.draw.line(screen, RAY, (ax, ay), _to_screen(ex, ey, world_h), 1)


def run(sim: Simulation, duration: int = 0) -> None:
    pygame.init()
    w_px = int(sim.world.width * SCALE) + PADDING * 2
    h_px = int(sim.world.height * SCALE) + PADDING * 2 + STATUS_H
    screen = pygame.display.set_mode((w_px, h_px))
    pygame.display.set_caption("SPECTER-1 // sim")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("Menlo,Monaco,Courier", 13)

    paused = False
    step_once = False
    tick_count = 0
    last: Tick | None = None
    target_fps = max(1, int(round(1.0 / sim.dt)))

    while True:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                pygame.quit()
                return
            if ev.type == pygame.KEYDOWN:
                if ev.key in (pygame.K_q, pygame.K_ESCAPE):
                    pygame.quit()
                    return
                if ev.key == pygame.K_SPACE:
                    paused = not paused
                if ev.key == pygame.K_n:
                    step_once = True
                if ev.key == pygame.K_s:
                    pygame.image.save(screen, f"specter_{tick_count:06d}.png")

        if (not paused or step_once) and (duration == 0 or tick_count < duration):
            last = sim.tick()
            tick_count += 1
            step_once = False

        screen.fill(BG)
        for w in sim.world.walls:
            pygame.draw.line(
                screen,
                WALL,
                _to_screen(w.x1, w.y1, sim.world.height),
                _to_screen(w.x2, w.y2, sim.world.height),
                2,
            )
        if last is not None:
            for agent in last.agents:
                _draw_lidar(screen, agent, last.scans[agent.id], sim.world.height)
            for agent in last.agents:
                _draw_agent(screen, agent, sim.world.height)
                ax, ay = _to_screen(agent.x, agent.y, sim.world.height)
                screen.blit(font.render(agent.id, True, INK), (ax + 10, ay + 8))

        flag = "DONE" if duration and tick_count >= duration else ("PAUSE" if paused else "RUN")
        flag_color = ALERT if flag in ("PAUSE", "DONE") else INK_DIM
        status = f"tick={tick_count:>5}  t={sim.t:6.2f}s  seed={sim.seed}  [SPACE N S Q]"
        screen.blit(font.render(status, True, INK_DIM), (PADDING, h_px - STATUS_H + 8))
        flag_surf = font.render(flag, True, flag_color)
        screen.blit(flag_surf, (w_px - PADDING - flag_surf.get_width(), h_px - STATUS_H + 8))

        pygame.display.flip()
        clock.tick(target_fps)
