export const SIM_CORE_VERSION = "0.4.0";

export {
  KIND_POSE,
  KIND_OBSERVATION,
  KIND_REPUTATION,
  KIND_LANDMARK_OBSERVATION,
  KIND_CONTACT_REPORT,
  type PoseReport,
  type Observation,
  type ReputationGossip,
  type LandmarkObservation,
  type ContactReport,
} from "./messages";

export {
  gridLandmarks,
  landmarkVisible,
  type Landmark,
} from "./landmarks";

export {
  cscFromTriplets,
  cscToDense,
  denseToCsc,
  cscTranspose,
  cscMatVec,
  cscNnz,
  cscCholesky,
  cscForwardSolve,
  cscBackwardSolve,
  cscCholeskySolve,
  type CSCMatrix,
} from "./sparseLinalg";

export {
  POSE2_IDENTITY,
  SE2_SMALL_ANGLE_TAU,
  wrapAngle,
  compose,
  inverse,
  between,
  expSE2,
  logSE2,
  rightJacobianSE2,
  odometryInformation,
  landmarkInformation,
  odometryResidual,
  landmarkResidual,
  DEFAULT_BEACON_RANGE_SIGMA_M,
  DEFAULT_BEACON_RANGE_SCALE_M,
  DEFAULT_BEACON_BEARING_SIGMA_RAD,
  NLOS_INFLATE,
  DEFAULT_IMU_ACCEL_BIAS_SIGMA,
  DEFAULT_IMU_GYRO_BIAS_SIGMA,
  type Pose2,
  type Mat2,
  type Mat3,
  type Factor,
  type OdometryFactor,
  type LandmarkFactor,
  PoseGraphTS,
  detectLoopClosures,
  umeyamaSim2,
  runSingleAgentLoopClosureDemo,
  singleAgentLoopClosureTruth,
  runCooperativeSlamDemo,
  cooperativeSlamTruth,
  type CooperativeScenario,
  type CooperativeSlamSnapshot,
  type LoopClosureFactor,
  type Sim2,
  type SlamSnapshot,
  REPUTATION_FLOOR,
  SLAM_CHISQ_INLIER,
  SLAM_CHISQ_OUTLIER,
  SINGLETON_INFO_SCALE,
  T_CORROBORATE,
  T_FADE,
  type Provenance,
  LOOP_MIN_KEYFRAME_GAP,
  LOOP_MIN_SHARED_LANDMARKS,
  LOOP_RESIDUAL_TAU_M,
  choleskySolve,
  JAC_EPS,
  LM_INITIAL_LAMBDA_SCALE,
  LM_MAX_ITERATIONS,
  LM_CONVERGE_DELTA,
  LM_CONVERGE_COST_RATIO,
} from "./poseGraph";

export { createRng, type Rng } from "./rng";

export {
  createAgent,
  stepAgent,
  snapshotAgent,
  type Agent,
} from "./agent";

export {
  BEACON_MAX_RANGE_M,
  BEACON_RANGE_SIGMA,
  BEACON_BEARING_SIGMA,
  BEACON_NLOS_PROB,
  BEACON_NLOS_BIAS,
  rangeBeacons,
  rangeBeaconsExact,
  type BeaconReturn,
  type BeaconOptions,
} from "./beacons";

export { Swarm, type Tick, type SwarmOptions, type VelocityCommand } from "./swarm";

export {
  eigSymmetric,
  zeros,
  identity,
  cloneMatrix,
  type Matrix,
  type EigenResult,
} from "./linalg";

export {
  embeddabilityScore,
  perPointResiduals,
  lyingEdgeResiduals,
  embed2D,
} from "./mds";

export {
  BetaTrustEvaluator,
  RANGE_RECIPROCAL_K_SIGMA,
  SIGMA_BEACON_RANGE_M,
  SIGMA_NLOS_RANGE_M,
  TIER1_DISAGREE_BETA,
  MIN_OBSERVER_WEIGHT,
  MIN_K_FOR_TIER2,
  MDS_EMBEDDABILITY_TAU,
  MDS_LYING_EDGE_M,
  MDS_BETA_CAP,
  GOSSIP_DISCOUNT,
  PRESENCE_WINDOW_NS,
  PRESENCE_BETA,
  OBSERVATION_PRESENCE_BETA,
  rangeSigma,
  type CohortEvent,
  type TierUsed,
  type EvaluatorOptions,
} from "./evaluator";

export {
  rangeLie,
  colluderPair,
  sensorFuzz,
  beaconSpoof,
  poseLie,
  driftPose,
  odometryCorrupt,
  swapKey,
  replayStorm,
  applyAttacks,
  applyPoseAttacks,
  RANGE_LIE_BIAS_M,
  COLLUDER_PAIR_BIAS_M,
  FUZZ_RANGE_SIGMA,
  FUZZ_BEARING_SIGMA,
  SPOOF_OFFSET,
  POSE_LIE_OFFSET_M,
  DRIFT_POSE_PER_TICK_M,
  ODOMETRY_BIAS_RAD_PER_TICK,
  REPLAY_REPETITIONS,
  type Attacker,
  type AttackFn,
  type PoseAttacker,
  type EnvelopeAttack,
  type EnvelopeAttackKind,
} from "./attacks";

export {
  SecureBus,
  encodeObservation,
  encodePoseReport,
  encodeContactReport,
  decodeObservation,
  decodePoseReport,
  decodeContactReport,
  tryOpen,
  sealAndOpenObservation,
  sealAndOpenPose,
  categorizeVerificationError,
  type RejectCategory,
} from "./secureBus";

export {
  type Item,
  DEFAULT_COP_SENSOR_RADIUS_M,
  distanceToItem,
  withinSensorRadius,
} from "./items";

export {
  buildCop,
  emitContactReportsThisTick,
  COP_TRUST_THRESHOLD,
  type MapAttack,
  type CopEntry,
  type PeerLocation,
} from "./contacts";

export {
  runScenario,
  runSecureScenario,
  finalReputations,
  detectionTick,
  type ScenarioSpec,
  type ScenarioResult,
  type SecureScenarioSpec,
  type SecureScenarioResult,
  type SecureTickSnapshot,
  type SlamView,
  type TickSnapshot,
  type GossipIngest,
  type BetaPair,
  type LinkPredicate,
  type Planner,
  type PlannerContext,
} from "./scenario";

export {
  generateKeypair,
  publicKeyFromPrivate,
  sign,
  verify,
  hexToBytes,
  bytesToHex,
  type Keypair,
} from "./crypto";

export {
  canonicalJson,
  canonicalJsonBytes,
  type CanonicalValue,
} from "./canonicalJson";

export {
  WIRE_VERSION,
  VerificationError,
  signedBlob,
  envelopeToWire,
  envelopeFromWire,
  newIdentity,
  seal,
  openEnvelope,
  type Envelope,
  type Identity,
  type Roster,
  type ReplayWindow,
} from "./envelope";

export {
  PRIOR_ALPHA,
  PRIOR_BETA,
  DECAY_HALF_LIFE_NS,
  newReputation,
  score,
  decay,
  observe,
  type PeerReputation,
  type Evidence,
} from "./reputation";
