// Every tunable constant in the sim. Server and clients must use the same
// literal values: never derive these with Math.exp/pow at runtime, because those
// can differ in the last bit between engines.

export interface SimParams {
  // Ball flight
  gravity: number;
  /** Quadratic drag above the drag crisis: a = −dragK·|v|·v (dragK = ρ·Cd·A / 2m) */
  dragK: number;
  /** Drag crisis: below dragCrisisLow the drag coefficient is dragLowScale× higher, blending up to dragCrisisHigh */
  dragCrisisLow: number;
  dragCrisisHigh: number;
  dragLowScale: number;
  /** Magnus: a = magnusK·(ω × v) */
  magnusK: number;
  spinDecayPerTick: number;
  groundRestitution: number;
  /** Least horizontal speed a bounce keeps (steep bounces) */
  groundTangential: number;
  /** Grass friction coefficient during a bounce (shallow bounces skid and keep more) */
  groundFriction: number;
  rollDecel: number;
  rollSpinDecayPerTick: number;
  postRestitution: number;
  postTangential: number;
  postSpinRetain: number;
  wallRestitution: number;
  wallTangential: number;

  // Kick input → launch
  /** Launch speed at power 0 and 1 */
  minSpeed: number;
  maxSpeed: number;
  powerExponent: number;
  /** A typical well-struck free kick; used by the AI and the tuning checks */
  vRef: number;
  /**
   * Most sidespin a strike can carry, rad/s, at vRef. Set past what feet
   * manage (pros reach ~10–17 rev/s) so full curl bends like the most
   * spectacular free kicks and then some: the game's licence for fun.
   */
  maxSpin: number;
  /** Topspin a curled strike carries per unit of sidespin (makes curlers dip) */
  topspinPerSidespin: number;
  /** Outside-of-the-boot (trivela) strikes: share of maxSpin they can carry, and their strike error multiplier */
  trivelaSpinScale: number;
  trivelaErrorScale: number;
  /** Chips: backspin (rad/s) and launch elevation at power 1 and 0 (degrees) */
  chipBackspin: number;
  chipElevMinDeg: number;
  chipElevMaxDeg: number;
  /** Off-centre contact trades pace for spin: full curl loses this fraction of speed */
  curvePaceLoss: number;
  overhitThreshold: number;
  overhitDeg: number;
  /** Shot height for the longest swipe (harness pad) */
  maxTargetHeight: number;
  /** Aims below this height (m) are driven low: capped to a skimming elevation */
  lowShotHeight: number;
  /** Strike error σ (degrees of launch direction): base + power²·powerDeg + curl·curlDeg */
  aimErrorBaseDeg: number;
  aimErrorPowerDeg: number;
  aimErrorCurlDeg: number;
  /** Vertical error as a fraction of the horizontal one */
  aimErrorVerticalScale: number;
  /** Spin error σ, as a fraction of the spin */
  spinErrorFrac: number;

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
  // Ball 0.43 kg, r 0.11 m, ρ 1.2: Cd ≈ 0.22 past the drag crisis, ≈ 0.42 below it.
  dragK: 0.0115,
  dragCrisisLow: 10,
  dragCrisisHigh: 16,
  dragLowScale: 1.9,
  // Lift coefficient ≈ 0.85 × spin parameter (rω/v), within measured ball data (Cl ≈ 0.25 for a pro's 10 rev/s curler).
  magnusK: 0.005,
  spinDecayPerTick: 0.9989588756797245, // exp(−dt / 4 s)
  groundRestitution: 0.55,
  groundTangential: 0.7,
  groundFriction: 0.4,
  rollDecel: 0.5,
  rollSpinDecayPerTick: 0.991701292638876, // exp(−dt / 0.5 s)
  postRestitution: 0.65,
  postTangential: 0.9,
  postSpinRetain: 0.5,
  wallRestitution: 0.4,
  wallTangential: 0.8,

  minSpeed: 12,
  maxSpeed: 36,
  powerExponent: 0.7,
  vRef: 27,
  maxSpin: 105,
  topspinPerSidespin: 0.25,
  trivelaSpinScale: 0.8,
  trivelaErrorScale: 1.25,
  chipBackspin: 25,
  chipElevMinDeg: 28,
  chipElevMaxDeg: 45,
  curvePaceLoss: 0.06,
  overhitThreshold: 0.92,
  overhitDeg: 50,
  maxTargetHeight: 3.2,
  lowShotHeight: 0.6,
  aimErrorBaseDeg: 0.25,
  aimErrorPowerDeg: 0.7,
  aimErrorCurlDeg: 0.4,
  aimErrorVerticalScale: 0.8,
  spinErrorFrac: 0.08,

  diveAutoTime: 1,
  keeperWindup: 0.08,
  diveBaseTime: 0.48,
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
  wallJumpHeight: 0.3,
  wallJumpDuration: 0.5,
});
