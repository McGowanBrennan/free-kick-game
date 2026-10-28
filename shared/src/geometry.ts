// Pitch and goal geometry, SI units.
// Origin: centre of the goal line on the ground. +z points out into the field,
// +x is the shooter's right, +y is up. The keeper faces +z, so keeper-left is +x.

export const BALL_RADIUS = 0.11;

export const GOAL_HALF_WIDTH = 3.66; // inside edge of each post
export const GOAL_HEIGHT = 2.44; // underside of the bar
export const POST_RADIUS = 0.06;
export const POST_X = GOAL_HALF_WIDTH + POST_RADIUS; // post centre line
export const BAR_Y = GOAL_HEIGHT + POST_RADIUS; // bar centre line
export const NET_DEPTH = 2.0;
/** The ball has wholly crossed the line once its centre passes this plane. */
export const GOAL_CROSS_Z = -(POST_RADIUS + BALL_RADIUS);

export const BOX_DEPTH = 16.5;
export const BOX_HALF_WIDTH = 20.16;
export const SIX_DEPTH = 5.5;
export const SIX_HALF_WIDTH = 9.16;
export const PENALTY_SPOT_Z = 11;

export const WALL_DISTANCE = 9.15;
export const WALL_SPACING = 0.5;
export const WALL_PLAYER_RADIUS = 0.22;
export const WALL_PLAYER_HEIGHT = 1.85;

export const KEEPER_Z = 0.3;

export const TICK_RATE = 240;
export const DT = 1 / TICK_RATE;
export const MAX_SIM_TICKS = 4 * TICK_RATE;
/** Generic run-up before contact (SPEC §5.3). */
export const RUNUP_TICKS = Math.round(1.2 * TICK_RATE);
