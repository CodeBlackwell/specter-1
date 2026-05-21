"""Run from specter-1 repo root with `uv run python ui/packages/sim-core/tests/fixtures/_generate.py`.
Emits parity.json next to this file. Regenerate whenever the wire contract changes.
"""

import json
from pathlib import Path

from specter.crypto import Keypair
from specter.secure_bus import Envelope, Identity, _signed_blob, envelope_to_wire

OUT = Path(__file__).with_name("parity.json")


def _kp_hex(kp: Keypair) -> tuple[str, str]:
    priv = kp._private.private_numbers().private_value
    priv_hex = f"{priv:064x}"
    pub_hex = kp.public_bytes.hex()
    return priv_hex, pub_hex


def main() -> None:
    fixtures: dict[str, object] = {"version": 1, "curve": "P-256", "hash": "SHA-256"}

    # 1. Raw signing fixtures: known privkey signs known payload.
    raw_cases = []
    for i, msg in enumerate([b"hello", b"specter", b"", b"\x00\x01\x02\x03\xff"]):
        kp = Keypair.generate()
        priv_hex, pub_hex = _kp_hex(kp)
        sig = kp.sign(msg)
        raw_cases.append(
            {
                "label": f"raw_{i}",
                "priv_hex": priv_hex,
                "pub_hex": pub_hex,
                "msg_hex": msg.hex(),
                "sig_der_hex": sig.hex(),
            }
        )
    fixtures["raw_sign_verify"] = raw_cases

    # 2. Envelope blob fixtures: prove canonical-JSON byte-exact match.
    envelope_cases = []
    identity = Identity(agent_id="alpha", keypair=Keypair.generate())
    _, pub_hex = _kp_hex(identity.keypair)
    for kind, payload in [
        ("pose_report", b"{}"),
        ("observation", b'{"observer_id":"alpha"}'),
        ("reputation_gossip", bytes(range(16))),
    ]:
        env: Envelope = identity.seal(kind, payload, timestamp_ns=1_700_000_000_000_000_000)
        blob = _signed_blob(env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind, env.payload)
        envelope_cases.append(
            {
                "label": kind,
                "sender_pub_hex": pub_hex,
                "envelope": {
                    "version": env.version,
                    "sender_id": env.sender_id,
                    "nonce": env.nonce,
                    "timestamp_ns": env.timestamp_ns,
                    "kind": env.kind,
                    "payload_hex": env.payload.hex(),
                    "signature_der_hex": env.signature.hex(),
                },
                "signed_blob_hex": blob.hex(),
                "wire_hex": envelope_to_wire(env).hex(),
            }
        )
    fixtures["envelope"] = envelope_cases

    # 3. Beta decay fixtures: exact float trajectories the TS port must reproduce.
    # alpha=5.0, beta=2.0 at t=0; half-life 10s; sample at t = 0, 5s, 10s, 30s.
    half_life_ns = 10_000_000_000
    decay_cases = []
    for elapsed_ns in [0, 5_000_000_000, 10_000_000_000, 30_000_000_000]:
        alpha, beta = 5.0, 2.0
        if elapsed_ns > 0:
            factor = 0.5 ** (elapsed_ns / half_life_ns)
            alpha = 1.0 + (alpha - 1.0) * factor
            beta = 1.0 + (beta - 1.0) * factor
        decay_cases.append(
            {
                "elapsed_ns": elapsed_ns,
                "half_life_ns": half_life_ns,
                "alpha_start": 5.0,
                "beta_start": 2.0,
                "alpha_after": alpha,
                "beta_after": beta,
                "score_after": alpha / (alpha + beta),
            }
        )
    fixtures["decay"] = decay_cases

    # 4. Beacon geometry: noise-free range + bearing must match exactly.
    import math as _m
    beacon_cases = []
    poses = [
        # (observer x, y, theta, peer x, y)
        (0.0, 0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 0.0, 1.0),
        (0.0, 0.0, _m.pi / 2, 1.0, 0.0),
        (1.0, 2.0, -_m.pi / 4, 4.0, 6.0),
        (-3.0, -3.0, _m.pi, -3.0, -3.5),
    ]
    for ox, oy, oth, px, py in poses:
        dx, dy = px - ox, py - oy
        rng = _m.hypot(dx, dy)
        brg = _m.atan2(dy, dx) - oth
        beacon_cases.append(
            {"obs": [ox, oy, oth], "peer": [px, py], "range_m": rng, "bearing_rad": brg}
        )
    fixtures["beacons_exact"] = beacon_cases

    # 5. MDS parity: embeddability scores + lying-edge residuals on canonical matrices.
    import numpy as _np
    from specter.trust import mds as _mds

    def _D_from_points(pts):
        n = len(pts)
        D = _np.zeros((n, n))
        for i in range(n):
            for j in range(n):
                D[i, j] = _m.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
        return D

    mds_cases = []
    # 5a. Honest 4-peer square — perfectly 2D-embeddable.
    honest_square = [(0, 0), (1, 0), (1, 1), (0, 1)]
    D = _D_from_points(honest_square)
    mds_cases.append(
        {
            "label": "honest_square",
            "D": D.tolist(),
            "embeddability": float(_mds.embeddability_score(D)),
            "per_point": _mds.per_point_residuals(D).tolist(),
            "lying_edge": _mds.lying_edge_residuals(D).tolist(),
        }
    )
    # 5b. Honest 5-peer pentagon.
    pentagon = [
        (_m.cos(2 * _m.pi * k / 5), _m.sin(2 * _m.pi * k / 5)) for k in range(5)
    ]
    D = _D_from_points(pentagon)
    mds_cases.append(
        {
            "label": "honest_pentagon",
            "D": D.tolist(),
            "embeddability": float(_mds.embeddability_score(D)),
            "per_point": _mds.per_point_residuals(D).tolist(),
            "lying_edge": _mds.lying_edge_residuals(D).tolist(),
        }
    )
    # 5c. Colluder pair: 4-peer square, edge 0↔1 inflated by 3m symmetrically.
    D_collude = _D_from_points(honest_square).copy()
    D_collude[0, 1] = D_collude[1, 0] = D_collude[0, 1] + 3.0
    mds_cases.append(
        {
            "label": "colluder_pair_0_1",
            "D": D_collude.tolist(),
            "embeddability": float(_mds.embeddability_score(D_collude)),
            "per_point": _mds.per_point_residuals(D_collude).tolist(),
            "lying_edge": _mds.lying_edge_residuals(D_collude).tolist(),
        }
    )
    fixtures["mds"] = mds_cases

    # 6. Landmark grid generation (ADR 0016 §5 — pose-graph SLAM substrate).
    # Mirrors the TS `gridLandmarks` helper so the Python world model and the
    # sim-core landmarks module emit byte-identical landmark sets given the
    # same (minX, minY, maxX, maxY, spacingM) parameters. Used as ground
    # truth in pose-graph SLAM evals.
    landmark_cases = []

    def _grid_landmarks(min_x: float, min_y: float, max_x: float, max_y: float, spacing: float):
        nx = int((max_x - min_x) / spacing) + 1
        ny = int((max_y - min_y) / spacing) + 1
        return [
            {"id": f"lm-{ix:02d}-{iy:02d}", "x": min_x + ix * spacing, "y": min_y + iy * spacing}
            for iy in range(ny)
            for ix in range(nx)
        ]

    for label, params in [
        ("workshop_5m", (0.0, 0.0, 20.0, 20.0, 5.0)),
        ("workshop_2m", (0.0, 0.0, 10.0, 10.0, 2.0)),
        ("offset_origin", (3.0, 7.0, 18.0, 22.0, 4.0)),
    ]:
        landmark_cases.append(
            {
                "label": label,
                "params": {
                    "min_x": params[0], "min_y": params[1],
                    "max_x": params[2], "max_y": params[3],
                    "spacing_m": params[4],
                },
                "landmarks": _grid_landmarks(*params),
            }
        )
    fixtures["landmarks"] = landmark_cases

    # 7. CSC sparse matrix round-trip (ADR 0016 §11 + §14). The sparse pipeline
    # in Wave 1 depends on Python ↔ TS CSC encoding agreeing byte-for-byte.
    # These fixtures exercise dense→CSC→dense and CSC matvec on small
    # representative matrices.
    try:
        import scipy.sparse as _sp

        csc_cases = []

        def _csc_case(label: str, dense_list: list[list[float]], vec: list[float]):
            arr = _np.array(dense_list, dtype=float)
            sp_csc = _sp.csc_matrix(arr)
            y = sp_csc @ _np.array(vec, dtype=float)
            csc_cases.append(
                {
                    "label": label,
                    "dense": dense_list,
                    "csc": {
                        "nrows": int(arr.shape[0]),
                        "ncols": int(arr.shape[1]),
                        "indptr": sp_csc.indptr.tolist(),
                        "indices": sp_csc.indices.tolist(),
                        "data": sp_csc.data.tolist(),
                    },
                    "matvec": {"x": vec, "y": y.tolist()},
                }
            )

        # 7a. 3×3 identity — simplest non-trivial CSC.
        _csc_case(
            "identity_3x3",
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            [2.0, -3.0, 4.0],
        )
        # 7b. 4×4 symmetric tridiagonal — representative of a 1D pose-chain Hessian.
        _csc_case(
            "tridiag_4x4",
            [
                [2.0, -1.0, 0.0, 0.0],
                [-1.0, 2.0, -1.0, 0.0],
                [0.0, -1.0, 2.0, -1.0],
                [0.0, 0.0, -1.0, 2.0],
            ],
            [1.0, 2.0, 3.0, 4.0],
        )
        # 7c. 5×5 mixed pattern — non-zeros off-diagonal in non-trivial places.
        _csc_case(
            "mixed_5x5",
            [
                [3.0, 0.0, 1.0, 0.0, 0.0],
                [0.0, 4.0, 0.0, 2.0, 0.0],
                [1.0, 0.0, 5.0, 0.0, 1.0],
                [0.0, 2.0, 0.0, 6.0, 0.0],
                [0.0, 0.0, 1.0, 0.0, 7.0],
            ],
            [1.0, 0.5, -1.0, 2.0, -0.5],
        )
        fixtures["csc"] = csc_cases
    except ImportError:
        # scipy is in the workshop extra; if it's absent the fixture skips.
        pass

    # 8. SE(2) Lie group parity (ADR 0016 §6 — pose-graph SLAM substrate).
    # Locks the right-perturbation conventions across Python ↔ TS. The
    # foundation under every factor / optimizer / sparse-solver result;
    # divergence here cascades through every Wave 1+ deliverable.
    from specter.slam import pose_graph as _pg

    se2_cases = []
    # 8a. exp / log round-trip on representative tangent vectors covering:
    #     - pure rotation, pure translation, mixed
    #     - small-angle Taylor branch (|θ| < SE2_SMALL_ANGLE_TAU = 1e-5)
    #     - large rotations near ±π
    #     - asymmetric ρ to exercise the V(θ) off-diagonal terms
    exp_cases = []
    test_xis = [
        ("zero", (0.0, 0.0, 0.0)),
        ("pure_translation_x", (1.0, 0.0, 0.0)),
        ("pure_translation_y", (0.0, 1.0, 0.0)),
        ("pure_translation_diag", (1.5, -0.7, 0.0)),
        ("pure_rotation_small", (0.0, 0.0, 0.1)),
        ("pure_rotation_quarter", (0.0, 0.0, _m.pi / 2)),
        ("pure_rotation_three_quarters", (0.0, 0.0, 3 * _m.pi / 4)),
        ("small_angle_taylor", (0.2, -0.3, 1.0e-7)),
        ("mixed_modest", (0.5, 0.3, 0.7)),
        ("mixed_asymmetric", (-1.2, 0.8, -0.45)),
        ("large_rotation", (2.0, -1.0, 2.9)),
    ]
    for label, xi in test_xis:
        pose = _pg.exp_se2(xi)
        xi_back = _pg.log_se2(pose)
        jr = _pg.right_jacobian_se2(xi)
        exp_cases.append(
            {
                "label": label,
                "xi": list(xi),
                "exp": {"x": pose.x, "y": pose.y, "theta": pose.theta},
                "log_round_trip": list(xi_back),
                "right_jacobian": [list(row) for row in jr],
            }
        )
    se2_cases.append({"section": "exp_log_jacobian", "cases": exp_cases})

    # 8b. compose / inverse / between parity on pose pairs.
    compose_cases = []
    pose_pairs = [
        ("identity_left", (0.0, 0.0, 0.0), (1.5, -0.7, 0.4)),
        ("identity_right", (1.5, -0.7, 0.4), (0.0, 0.0, 0.0)),
        ("pure_translations", (1.0, 2.0, 0.0), (-0.5, 1.5, 0.0)),
        ("pure_rotations", (0.0, 0.0, 0.6), (0.0, 0.0, -0.3)),
        ("general_a", (1.0, 0.5, 0.7), (0.3, -0.2, 0.1)),
        ("general_b", (-1.0, 2.0, -0.4), (1.5, -1.5, 1.2)),
    ]
    for label, a_tup, b_tup in pose_pairs:
        a = _pg.Pose2(*a_tup)
        b = _pg.Pose2(*b_tup)
        comp = _pg.compose(a, b)
        inv_a = _pg.inverse(a)
        bet = _pg.between(a, b)
        compose_cases.append(
            {
                "label": label,
                "a": {"x": a.x, "y": a.y, "theta": a.theta},
                "b": {"x": b.x, "y": b.y, "theta": b.theta},
                "compose": {"x": comp.x, "y": comp.y, "theta": comp.theta},
                "inverse_a": {"x": inv_a.x, "y": inv_a.y, "theta": inv_a.theta},
                "between_ab": {"x": bet.x, "y": bet.y, "theta": bet.theta},
            }
        )
    se2_cases.append({"section": "group_ops", "cases": compose_cases})

    fixtures["se2"] = se2_cases

    # 9. End-to-end optimizer parity (ADR 0016 §14 — Wave 1.6 gate).
    # Locks the LM + GNC outputs at 10/8 decimal agreement between Python and TS.
    # If this fails, the math diverged — and the parity contract is breached.
    from specter.slam.pose_graph import (
        OdometryFactor as _Odo,
        LandmarkFactor as _Lf,
        PoseGraph as _PG,
        between as _btw,
        landmark_information as _lminfo,
        odometry_information as _oinfo,
    )

    def _build_chain_with_drift() -> _PG:
        truth = [
            _pg.Pose2(0.0, 0.0, 0.0),
            _pg.Pose2(1.0, 0.0, 0.0),
            _pg.Pose2(2.0, 0.0, 0.0),
            _pg.Pose2(3.0, 0.0, 0.0),
        ]
        graph = _PG()
        # Initialize all poses with deterministic drift to exercise LM convergence.
        drift = [(0.0, 0.0, 0.0), (1.1, 0.05, 0.02), (2.15, 0.10, 0.04), (3.18, 0.13, 0.05)]
        for i, (dx, dy, dt) in enumerate(drift):
            graph.add_pose(f"p{i}", _pg.Pose2(dx, dy, dt))
        info = _oinfo(0.5)
        for i in range(len(truth) - 1):
            graph.add_odometry_factor(
                _Odo(
                    from_id=f"p{i}",
                    to_id=f"p{i+1}",
                    measurement=_btw(truth[i], truth[i + 1]),
                    info=info,
                    source_id="alpha",
                )
            )
        return graph

    optimizer_cases = []

    # 9a. LM convergence on a 4-pose chain with consistent odometry.
    pg_lm = _build_chain_with_drift()
    pg_lm.optimize()
    optimizer_cases.append(
        {
            "label": "lm_4pose_chain",
            "trajectory": [
                {"id": pid, "x": p.x, "y": p.y, "theta": p.theta} for pid, p in pg_lm.trajectory()
            ],
            "landmarks": {},
            "final_cost": pg_lm.final_cost,
            "iterations": pg_lm.iterations_last_run,
        }
    )

    # 9b. GNC outlier suppression on a landmark observation set with one liar.
    def _build_gnc_case() -> _PG:
        graph = _PG()
        graph.add_pose("p0", _pg.Pose2(0.0, 0.0, 0.0))
        graph.add_landmark("lm0", (4.0, 0.0))
        truth_range = 5.0
        truth_bearing = 0.0
        for i in range(3):
            graph.add_landmark_factor(
                _Lf(
                    pose_id="p0",
                    landmark_id="lm0",
                    range_m=truth_range,
                    bearing_rad=truth_bearing,
                    info=_lminfo(truth_range),
                    source_id=f"obs_{i}",
                )
            )
        graph.add_landmark_factor(
            _Lf(
                pose_id="p0",
                landmark_id="lm0",
                range_m=truth_range + 5.0,  # outlier
                bearing_rad=truth_bearing,
                info=_lminfo(truth_range),
                source_id="outlier",
            )
        )
        return graph

    pg_gnc = _build_gnc_case()
    pg_gnc.optimize_gnc()
    optimizer_cases.append(
        {
            "label": "gnc_landmark_outlier_suppression",
            "trajectory": [
                {"id": pid, "x": p.x, "y": p.y, "theta": p.theta} for pid, p in pg_gnc.trajectory()
            ],
            "landmarks": {k: list(v) for k, v in pg_gnc.landmarks().items()},
            "final_cost": pg_gnc.final_cost,
            "gnc_outer_iters": pg_gnc.gnc_outer_iters_last_run,
            "gnc_weights": pg_gnc.gnc_weights(),
        }
    )

    fixtures["optimizer"] = optimizer_cases

    OUT.write_text(json.dumps(fixtures, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
