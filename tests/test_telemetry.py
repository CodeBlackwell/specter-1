"""Tests for the telemetry subsystem: schema, sinks, trace."""

import json
from pathlib import Path

import pytest

from specter.telemetry import AnomalyEvent, JsonlTelemetrySink, ReputationTrace
from specter.trust import BetaTrustEvaluator, ListTelemetry


# ---------- US-001: AnomalyEvent schema ----------


def test_anomaly_event_round_trip():
    kwargs = {
        "category": "outlier_observation",
        "sender_id": "alpha",
        "nonce": 42,
        "timestamp_ns": 1_000_000_000,
        "detail": "alpha disagrees with 2 peers about bravo",
    }
    event = AnomalyEvent.from_emit_kwargs(**kwargs)
    assert event.category == "outlier_observation"
    assert event.sender_id == "alpha"
    assert event.nonce == 42
    assert event.timestamp_ns == 1_000_000_000
    assert event.to_emit_kwargs() == kwargs


def test_anomaly_event_is_frozen():
    event = AnomalyEvent("x", "y", 0, 0, "")
    with pytest.raises((AttributeError, Exception)):
        event.category = "z"  # type: ignore[misc]


@pytest.mark.parametrize(
    "category",
    [
        "outlier_observation",
        "geometric_inconsistency",
        "no_beacon_presence",
        "replay",
        "bad_signature",
        "unknown_sender",
        "version_mismatch",
    ],
)
def test_anomaly_event_accepts_all_known_categories(category):
    event = AnomalyEvent.from_emit_kwargs(
        category=category, sender_id="x", nonce=1, timestamp_ns=0, detail=""
    )
    assert event.category == category


def test_anomaly_event_round_trip_from_real_evaluator():
    """Drive a BetaTrustEvaluator into a range_inconsistency emit, then
    parse the captured kwargs through `AnomalyEvent.from_emit_kwargs` and
    confirm the schema accepts the live payload."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    for subject in ("alpha", "bravo"):
        granters = evaluator._seen_by.setdefault(subject, {})
        for observer in ("alpha", "bravo"):
            if observer != subject:
                granters[observer] = 0
    from specter.crypto import Keypair
    from specter.messages import KIND_OBSERVATION, Observation, encode
    from specter.secure_bus import Identity

    idents = {a: Identity(a, Keypair.generate()) for a in ["alpha", "bravo"]}
    # Reciprocal range disagreement: alpha reports r=3, bravo reciprocates with r=8.
    obs_ab = Observation("alpha", "bravo", 3.0, 0.0, 100)
    evaluator.record_observation(idents["alpha"].seal(KIND_OBSERVATION, encode(obs_ab), 100), obs_ab)
    obs_ba = Observation("bravo", "alpha", 8.0, 0.0, 100)
    evaluator.record_observation(idents["bravo"].seal(KIND_OBSERVATION, encode(obs_ba), 100), obs_ba)
    evaluator.flush()

    anomalies = [
        AnomalyEvent.from_emit_kwargs(**fields)
        for event, fields in telemetry.events
        if event == "trust.anomaly"
    ]
    assert len(anomalies) >= 1
    assert any(a.category == "range_inconsistency" for a in anomalies)


# ---------- US-002: JsonlTelemetrySink ----------


def test_jsonl_sink_writes_one_line_per_emit(tmp_path: Path):
    path = tmp_path / "events.jsonl"
    sink = JsonlTelemetrySink(path)
    sink.emit("trust.anomaly", sender_id="x", nonce=1, timestamp_ns=10, detail="d", category="c")
    sink.emit("trust.anomaly", sender_id="y", nonce=2, timestamp_ns=20, detail="e", category="c")
    lines = path.read_text().splitlines()
    assert len(lines) == 2
    rec0 = json.loads(lines[0])
    assert rec0["event"] == "trust.anomaly"
    assert rec0["sender_id"] == "x"
    assert "wall_clock_ns" in rec0


def test_jsonl_sink_round_trip_1000_events(tmp_path: Path):
    path = tmp_path / "bulk.jsonl"
    sink = JsonlTelemetrySink(path)
    for i in range(1000):
        sink.emit(
            "trust.anomaly",
            sender_id=f"peer{i}",
            nonce=i,
            timestamp_ns=i * 1000,
            detail=f"detail-{i}",
            category="outlier_observation",
        )
    lines = path.read_text().splitlines()
    assert len(lines) == 1000
    for i, line in enumerate(lines):
        rec = json.loads(line)
        assert rec["event"] == "trust.anomaly"
        assert rec["sender_id"] == f"peer{i}"
        assert rec["nonce"] == i
        assert rec["timestamp_ns"] == i * 1000
        assert rec["detail"] == f"detail-{i}"
        assert rec["category"] == "outlier_observation"


def test_jsonl_sink_appends_across_restarts(tmp_path: Path):
    path = tmp_path / "restart.jsonl"
    sink_a = JsonlTelemetrySink(path)
    sink_a.emit("e", k=1)
    sink_b = JsonlTelemetrySink(path)
    sink_b.emit("e", k=2)
    lines = path.read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["k"] == 1
    assert json.loads(lines[1])["k"] == 2


def test_jsonl_sink_handles_large_detail(tmp_path: Path):
    path = tmp_path / "big.jsonl"
    sink = JsonlTelemetrySink(path)
    big = "x" * 100_000
    sink.emit("trust.anomaly", detail=big, sender_id="a", nonce=1, timestamp_ns=0, category="c")
    line = path.read_text().splitlines()[0]
    rec = json.loads(line)
    assert rec["detail"] == big
    assert len(rec["detail"]) == 100_000


def test_list_telemetry_still_available():
    telemetry = ListTelemetry()
    telemetry.emit("e", k=1)
    assert telemetry.events == [("e", {"k": 1})]


# ---------- US-003: ReputationTrace ----------


def test_reputation_trace_records_and_queries():
    trace = ReputationTrace()
    for t in range(100):
        for peer in ("alpha", "bravo", "charlie", "delta"):
            trace.record(peer, alpha=1.0 + t, beta=1.0, t_ns=t)
    assert sorted(trace.peers()) == ["alpha", "bravo", "charlie", "delta"]
    for peer in trace.peers():
        series = trace.series(peer)
        assert len(series) == 100
        assert series == sorted(series, key=lambda row: row[0])
        assert series[0][0] == 0
        assert series[-1][0] == 99


def test_reputation_trace_ring_buffer_drops_oldest():
    trace = ReputationTrace(max_per_peer=10)
    for t in range(25):
        trace.record("alpha", alpha=float(t), beta=1.0, t_ns=t)
    series = trace.series("alpha")
    assert len(series) == 10
    assert [row[0] for row in series] == list(range(15, 25))


def test_reputation_trace_unknown_peer_returns_empty():
    trace = ReputationTrace()
    assert trace.series("ghost") == []
    assert trace.peers() == []
