from dataclasses import dataclass


@dataclass
class Agent:
    id: str
    x: float
    y: float
    theta: float
    vx: float = 0.0
    vy: float = 0.0
    omega: float = 0.0

    def step(self, dt: float) -> None:
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.theta += self.omega * dt

    def snapshot(self) -> "Agent":
        return Agent(self.id, self.x, self.y, self.theta, self.vx, self.vy, self.omega)
