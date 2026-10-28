// Every tunable constant in the sim. Server and clients must use the same
// literal values: never derive these with Math.exp/pow at runtime, because those
// can differ in the last bit between engines.

export interface SimParams {
  // Ball flight
  gravity: number;
  /** Quadratic drag: a = −dragK·|v|·v */
  dragK: number;
  /** Magnus: a = magnusK·(ω × v) */
  magnusK: number;
  spinDecayPerTick: number;
  groundRestitution: number;
  groundTangential: number;
  rollDecel: number;
  rollSpinDecayPerTick: number;
  postRestitution: number;
  postTangential: number;
  postSpinRetain: number;
  wallRestitution: number;
  wallTangential: number;

  // Kick input → launch
  minSpeed: number;
  maxSpeed: number;
  powerExponent: number;
  /** Reference speed used to solve elevation and curl compensation */
  vRef: number;
  maxSpin: number;
  curlCompensation: number;
  overhitThreshold: number;
  overhitDeg: number;
  aimOutsidePost: number;
  maxTargetHeight: number;

  // Keeper dive
  /** 1 = an early flick waits so the dive peaks as the ball arrives; 0 = dive immediately */
  diveAutoTime: number;
  keeperWindup: number;
  diveBaseTime: number;
  diveTimePerMeter: number;
  /** Extra dive time per metre of hand height above 1 m */
  diveTimePerHeight: number;
  /** Lateral reach multiplier for dives at full height */
  highReachScale: number;
  diveHold: number;
  diveFall: number;
  minHandReach: number;
  maxHandReach: number;
  lowHandY: number;
  highHandY: number;
  jumpHandY: number;

  // Keeper set / stance auto-block
  setReachX: number;
  setReachY: number;
  setHandSpeed: number;
  stanceReachX: number;
  stanceReachY: number;
  stanceHandSpeed: number;

  // Keeper contact
  catchMaxSpeed: number;
  catchMaxStretch: number;
  parryRestitution: number;
  parryTangential: number;
  /** Contacts more glancing than this (0 head-on … 1 grazing) count as weak touches */
  weakGlancing: number;
  weakKeepMin: number;
  weakKeepMax: number;
  weakDeflect: number;

  // Wall
  wallJumpDelay: number;
  wallJumpHeight: number;
  wallJumpDuration: number;
}

export const DEFAULT_PARAMS: Readonly<SimParams> = Object.freeze({
  gravity: 9.81,
  dragK: 0.01,
  magnusK: 0.0042,
  spinDecayPerTick: 0.9989588756797245, // exp(−dt / 4 s)
  groundRestitution: 0.55,
  groundTangential: 0.7,
  rollDecel: 0.5,
  rollSpinDecayPerTick: 0.991701292638876, // exp(−dt / 0.5 s)
  postRestitution: 0.65,
  postTangential: 0.9,
  postSpinRetain: 0.5,
  wallRestitution: 0.4,
  wallTangential: 0.8,

  minSpeed: 14,
  maxSpeed: 32,
  powerExponent: 1.3,
  vRef: 27,
  maxSpin: 60,
  curlCompensation: 1,
  overhitThreshold: 0.85,
  overhitDeg: 40,
  aimOutsidePost: 1.5,
  maxTargetHeight: 3.4,

  diveAutoTime: 1,
  keeperWindup: 0.08,
  diveBaseTime: 0.45,
  diveTimePerMeter: 0.15,
  diveTimePerHeight: 0.15,
  highReachScale: 0.85,
  diveHold: 0.25,
  diveFall: 0.35,
  minHandReach: 0.6,
  maxHandReach: 3.3,
  lowHandY: 0.3,
  highHandY: 2.45,
  jumpHandY: 2.75,

  setReachX: 1.0,
  setReachY: 2.5,
  setHandSpeed: 6,
  stanceReachX: 0.8,
  stanceReachY: 2.3,
  stanceHandSpeed: 4,

  catchMaxSpeed: 22,
  catchMaxStretch: 0.9,
  parryRestitution: 0.5,
  parryTangential: 0.3,
  weakGlancing: 0.3,
  weakKeepMin: 0.6,
  weakKeepMax: 0.85,
  weakDeflect: 0.25,

  wallJumpDelay: 0.1,
  wallJumpHeight: 0.45,
  wallJumpDuration: 0.5,
});
