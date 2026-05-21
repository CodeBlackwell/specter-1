# Contributing to SPECTER-1

Thanks for your interest. SPECTER-1 is a working demonstrator + workshop
curriculum for Byzantine-resilient cooperative SLAM. Contributions are
welcome — bug fixes, new attack scenarios, documentation, notebook
improvements, hardware adapters.

## Setup

```bash
just setup              # uv sync --all-extras
just test               # 260 tests, ~30s
just lint               # ruff + mypy
cd ui && pnpm install   # React Workshop Console
just ui-test            # TS sim-core parity suite
```

Requires Python 3.12+, pnpm 11+, Node 22+, and [`uv`](https://docs.astral.sh/uv/).

## Quality gates (must pass per change)

Python:
```bash
uv run pytest -q
uv run ruff check src tests
uv run mypy src
```

UI:
```bash
just ui-typecheck
just ui-test
just ui-build
```

After any change to wire format or core math, regenerate parity fixtures and
re-run UI tests:

```bash
just ui-fixtures
just ui-test
```

CI runs the same gates plus `nbconvert --execute` over all notebooks.

## Methodology — eval-first, slice-and-document

Every defensive change starts with an eval that measures the gap, then a slice
that closes it, then a doc update that records what was measured.

- Write the scenario in `tests/eval/scenarios.py` first; xfail it; implement
  until xpass. Numbers in `docs/THREAT_MODEL.md` come from test outcomes, not
  estimates.
- Each slice does one thing, ends green on pytest + ruff + mypy + UI tests,
  and includes a `docs/PROGRESS.md` entry.

Non-obvious design calls go in a new ADR under `docs/adr/` and get linked from
PROGRESS. Risks that survive sim get promoted to `docs/THREAT_MODEL.md` with a
measured bound.

See `CLAUDE.md` for the full methodology and audit-doc map.

## Commits

Lowercase, optional `category:` prefix, focus on the *why*:

```
feat: range-only trust voting (ADR 0015) — 5 waves end-to-end
fix(viz): pose triangle no longer drifts on long runs
docs(threat-model): tighten sybil-mutual scenario claim to measured bound
```

Body explains mechanism + empirical impact (detection ticks, scenario passes).

## Pull requests

- Small, focused PRs over large ones.
- Reference the ADR or threat-model claim your change affects.
- If you add a new attack or defense, add the corresponding scenario in
  `tests/eval/`.
- CI must be green.

## Reporting bugs

Open an issue with:
- Repro steps (scenario + scenario YAML or notebook cell)
- Expected vs. observed
- Output of `just test` if relevant

For **security-sensitive reports**, please see [`SECURITY.md`](SECURITY.md)
instead of opening a public issue.

## License

By contributing, you agree your contributions are licensed under the project's
[Business Source License 1.1](LICENSE), which converts to Apache License 2.0
on the Change Date.
