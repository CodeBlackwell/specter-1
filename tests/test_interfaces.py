"""Phase 0 exit gate: every ABC must compile + import. No swarm logic yet."""

from specter.interfaces import (
    ConsensusEngine,
    FactorResidual,
    LocalSlam,
    MapMerger,
    MessageBus,
    PoseGraphSlam,
    SensorAdapter,
    Telemetry,
    TrustEvaluator,
)


def test_eight_interfaces_present():
    assert {
        SensorAdapter,
        LocalSlam,
        MessageBus,
        TrustEvaluator,
        ConsensusEngine,
        MapMerger,
        PoseGraphSlam,
        Telemetry,
    }


def test_interfaces_are_abstract():
    for cls in (
        SensorAdapter,
        LocalSlam,
        MessageBus,
        TrustEvaluator,
        ConsensusEngine,
        MapMerger,
        PoseGraphSlam,
        Telemetry,
    ):
        assert getattr(cls, "__abstractmethods__"), f"{cls.__name__} has no abstract methods"


def test_pose_graph_slam_abc_shape():
    """Per ADR 0016: PoseGraphSlam exposes seven abstract methods including
    the per-factor residual emission hook for Wave 6+ bidirectional coupling."""
    expected = {
        "add_odometry",
        "add_landmark_observation",
        "add_inter_robot_observation",
        "optimize",
        "trajectory",
        "landmarks",
        "factor_residuals",
    }
    assert PoseGraphSlam.__abstractmethods__ == expected


def test_factor_residual_dataclass_fields():
    """Per ADR 0016 §2 preservation hooks: FactorResidual carries source_id +
    reputation_at_insertion so a future bidirectional adapter can correlate
    each residual with the trust state at insertion time."""
    fr = FactorResidual(
        factor_id="landmark/pose-3/lm-04-02",
        source_id="alpha",
        residual_norm=0.42,
        mahalanobis=0.31,
        reputation_at_insertion=0.95,
        iteration=4,
    )
    assert fr.source_id == "alpha"
    assert fr.reputation_at_insertion == 0.95
    assert fr.iteration == 4
