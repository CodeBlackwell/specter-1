from dataclasses import dataclass, field


@dataclass(frozen=True)
class Wall:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass(frozen=True)
class Landmark:
    """A stationary point feature with a stable identifier. The pose-graph SLAM
    layer (ADR 0016) treats landmarks as jointly-estimated variables: their
    world position is recovered from agent observations during optimization,
    with the true position (here) used only as ground truth for evals."""

    id: str
    x: float
    y: float


@dataclass(frozen=True)
class Item:
    """A reportable point feature in the world — UXO, FOB, vehicle, etc.
    Distinguished from `Landmark` (jointly-estimated SLAM feature, ADR 0016)
    by being a *contact* the swarm reports into the Common Operating Picture.
    Per ADR 0019 (Python map-attack mechanism), each honest peer that
    overflies an item within sensor radius emits a `ContactReport` envelope;
    the trust-weighted COP aggregates reports across peers and filters by
    accumulated reporter reputation."""

    id: str
    kind: str  # "uxo", "fob", or any string label for renderer routing
    x: float
    y: float


@dataclass(frozen=True)
class World:
    walls: tuple[Wall, ...]
    width: float
    height: float
    landmarks: tuple[Landmark, ...] = field(default_factory=tuple)
    items: tuple[Item, ...] = field(default_factory=tuple)


def box_world(
    width: float,
    height: float,
    *interior: Wall,
    landmarks: tuple[Landmark, ...] = (),
    items: tuple[Item, ...] = (),
) -> World:
    bounds = (
        Wall(0.0, 0.0, width, 0.0),
        Wall(width, 0.0, width, height),
        Wall(width, height, 0.0, height),
        Wall(0.0, height, 0.0, 0.0),
    )
    return World(
        walls=bounds + interior,
        width=width,
        height=height,
        landmarks=landmarks,
        items=items,
    )
