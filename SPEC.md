# Free Kick Duel — Game Spec (v1)

A real-time 1v1 free kick contest for mobile web. Players alternate between shooting and keeping. Each player takes 5 kicks; ties go to sudden death. Every action is a single flick.

- **Platform:** mobile web, installable as a home-screen web app (PWA). Primary target: the latest 3 iPhone generations on iOS Safari. Must also run on recent Android Chrome and desktop browsers (desktop is for development; mouse drag stands in for flick).
- **Frame rate:** locked 60 fps target.
- **Orientation:** portrait only.

---

## 1. Match rules

### 1.1 Format
- Two players, A and B. A coin toss (server RNG); the winner chooses to shoot first or keep first (field goals: kick or defend first). Against the AI it's played out at midfield (§5.5): the player calls heads or tails, and the referee flips it.
- **Round** = A shoots / B keeps, then B shoots / A keeps. Both kicks in a round use the **same spot**.
- **Regulation:** 5 rounds (5 kicks each).
- **Early finish:** the match ends as soon as one player cannot be caught. Example: A leads 3–0 after A's 4th kick, B has 2 kicks left, so A wins. The check runs after every kick.
- **Sudden death:** if level after 5 rounds, play extra rounds with a new random spot each round. The same shooter order holds. A round decides the match when one player scores and the other does not. Rounds repeat with no limit. It's made to feel like it (§5.6): the game stops for a title card, the shot clock drops to 7 s, the screen's edges pulse, and the crowd hushes for every kick.

### 1.2 Kick outcomes
Each kick resolves to exactly one outcome, plus a detail tag for presentation and stats.

| Outcome | Rule | Detail tags |
|---|---|---|
| **Goal** | Ball fully crosses the goal line inside the frame at any time during the sim, even after posts, wall or keeper | `clean`, `off_post`, `off_bar`, `keeper_spill`, `deflection` (off the wall) |
| **Save** | No goal, and the keeper touched the ball | `caught`, `parried`, `tipped_wide`, `tipped_over` |
| **Blocked** | No goal, no keeper touch, wall touched | `wall` |
| **Miss** | Everything else | `wide`, `over`, `woodwork_out`, `short`, `shot_clock` |

Only Goal counts for scoring. The other three are a non-goal; the split is only for feedback and the replay caption.

### 1.3 Timers
| Phase | Limit | On timeout |
|---|---|---|
| Wall setup (keeper) | 8 s | Wall stays at the default position and size |
| Aim (shooter) | 10 s (7 s in sudden death) | Kick recorded as **Miss (`shot_clock`)** |
| Keeper reaction | Until the ball resolves | No flick means the keeper stays in the basic stance (smaller reach than "set") |
| Result + replay | 4 s (skippable when both players tap) | Auto-advance |

---

## 2. Kick spots

The server generates one spot per round from a seeded RNG. Spots are mirrored left/right with equal probability.

Coordinates: origin at the centre of the goal line on the ground. **+z** points out into the field, **+x** is right as seen by the shooter, and **+y** is up. All units are SI.

| Category | Weight | Region | Wall |
|---|---|---|---|
| Penalty | 35% | Fixed (0, 11): any kick inside the box is a penalty | No |
| Outside the box | 40% | Distance 18–25 m, angle from centre line ≤ 40°, position outside the box | Yes |
| Long range | 25% | Distance 25–35 m, angle ≤ 30° | Yes |

Pitch geometry: penalty box 16.5 m deep × 40.32 m wide. Goal 7.32 × 2.44 m (inside edges). Posts and bar 0.12 m diameter. Net depth 2.0 m.

### 2.1 Wall (outside-box and long-range spots only)
- **Size:** the keeper chooses 0 to max players. Max is 4 at ≤ 25 m, 3 at 25–30 m and 2 beyond 30 m. The default is max.
  - This is a deliberate trade-off. In the keeper's view, wall players can block the ball from sight at the strike, so a bigger wall covers more goal but hides the shot longer.
- **Position:** wall players stand on an arc 9.15 m from the ball. The default centre sits on the line from the ball to the near post. The keeper drags the wall along the arc, up to ±3.0 m from the default.
- **Spacing:** 0.5 m per player, shoulder to shoulder.
- **Jump:** the wall always jumps automatically (no player input). Take-off is 0.10 s after ball contact, the peak is +0.30 m at 0.35 s (a realistic standing jump: only a ball skidding along the grass gets under it), and it lands at 0.60 s. Timing is fixed, so it is deterministic.
- **Shooter visibility:** the shooter sees the final wall before aiming.

### 2.2 Keeper start position
The keeper starts on the goal line, z = 0.3, centred on the bisector of the angle from the ball to the two posts. Placement is automatic; the keeper does not set it.

---

## 3. Controls

All gestures use Pointer Events with `getCoalescedEvents()` for full-rate touch samples, and `touch-action: none` on the game canvas. Distances are normalised to **screen heights (sh)**, so feel is the same across devices. Gesture zones stay 24 px clear of the left and right edges to avoid OS edge gestures.

### 3.1 Shooter flick: draw the shot
The swipe starts in the lower 60% of the screen and moves upward. **Where the finger lifts is where the ball goes**, and the swipe's shape is the shot's shape: the ball sets off the way the finger set off and bends round to the release point.

| Flick | Read as | Shot |
|---|---|---|
| **Release point** | Cast through the camera onto the goal plane. Released below the goal (on the grass in front of it), it becomes a ground shot along that line | The aim point: lift your finger on the top corner to aim at the top corner, on the bar to hit the bar. Works from any camera angle the player picks |
| **Snap-back** | The path reverses sharply at its top (turns > 135° within 0.04 sh either side: a cusp, not the gradual turn of a curve rolling over), then drops ≥ 0.06 sh and ≥ 15% of the upward stroke, mostly straight down. A curve that rolls over and comes down at the end stays a curl, aimed where the finger lifts | A **chip**: the top of the swipe is the aim point, and the strike is a lofted chip with backspin (see below). From the penalty spot, aimed centrally, it's a Panenka |
| **Start** | Direction of the first 30% of the path, against the chord. A turn under 0.05 rad (≈ 3°) is a natural thumb arc and is ignored; beyond it the turn is ×1.5 (the early segment under-reads a curve's true start), capped at 0.6 rad. That turn is applied on screen to the ball → aim-point line, and where it meets the goal line (at the aimed height) gives the start line | Where on the goal line the ball's initial direction points. Start ≠ aim means curl |
| **Speed** | The flick's **peak** speed (fastest ≥ 40 ms window after the first 15% of the path), 1.0 → 7.2 sh/s; swipes shorter than 0.45 sh are scaled up by √(0.45/length), up to 1.35×, since a low aim is closer to the ball on screen and a short flick can't get as fast. Peak, not average, so a quick flick that slows to stop on its target (a low corner, the end of a curl) keeps its power (a quick flick to the goal is ~70–80%; overhit needs a real snap) | Power 0 → 1: launch speed 12 → 36 m/s (43 → 130 km/h) along p^0.7, so a quick flick to the goal (~3 sh/s, p ≈ 0.6) strikes at ~29 m/s, the speed free-kick studies measure (24–28 m/s typical), a slow deliberate swipe is a soft side-foot, and a real snap reaches Beckham's ~36 m/s. A weak strike can't loop to the top corner from long range and drops short |

While the finger is down a fading trail draws the swipe. After each strike the shooter sees a read-out (speed, power, curl) and a marker where they aimed, so the feel can be learned.

**Building the launch** (server-side; see §6.2):
1. The client sends T = (x, h), the aim point on the goal plane (clamped to ±8 m, 0.11–5 m), the start line sx on the goal line (clamped to ±14 m) and power.
2. The ball is launched horizontally toward sx. The server solves for the **sidespin and elevation** that bend it onto T at the pace struck. It uses Newton's method over free-flight passes of the sim's own integrator, so drag, the drag crisis and Magnus are all included.
3. Sidespin is capped at 105 rad/s for a 27 m/s strike, scaled with launch speed (×0.7–1.15: spin comes from foot speed, so a powerful curler still bends), and at 80% of that for a **trivela**. Our shooter is right-footed, so a ball bending right is struck with the outside of the boot: the read-out says "Trivela", the strike animation swings out to the right, and its strike error is ×1.25. For a bend tighter than that, the aim point wins: the ball starts as wide as full curl can still bring back onto T (so a penalty can't be bent much; a 30 m free kick can).
4. A curler is struck across and up the side of the ball, so it carries topspin of 0.25 × its sidespin, and curled shots dip. Off-centre contact also trades pace for spin: speed × (1 − 0.06·|spin| / max).
5. **Low shots are driven, not dropped.** An aim below 0.6 m caps the launch elevation so the ball peaks at no more than 0.25 m + half the aim height: it skims, bounces and skids in (a soft low shot from 25 m would otherwise need a 17° lob onto the target). The cap fades out by ~1 m. Elevation is capped at 34° overall.
6. Power changes pace (how much time the keeper has), not where the ball goes, except when **overhit:** above power 0.92, extra lift is added (`+ (p − 0.92) · 50°`, up to 4°), which sends the ball over the bar.

**Invalid swipe** (ignored, no penalty, the player may retry within the shot clock): chord shorter than 0.06 sh, duration over 1 s, leaning more than 80° from straight up, or pointing away from the goal.

**Chips and the Panenka.** A chip is scooped up at 45° (power 0, a floating Panenka) down to 28° (power 1, a quicker lob) with 25 rad/s of backspin, and the server bisects for the pace that puts it on the aimed height at the goal line. No sidespin. A Panenka from the spot is ~40 km/h, peaks near 3 m and takes over a second, so it beats a keeper who has dived and is easily caught by one who stays.

**Strike error.** No strike comes off the foot exactly as meant. After the launch is solved, the server turns its direction by a random error (seeded, so every client replays the same shot): σ = 0.25° + 0.7°·power² + 0.4°·curl horizontally, 0.8× that vertically, and the spin varies by 8%. Free-kick studies find players must hold launch angles within about 3° to hit a 1 m² target from 20 m; at typical power this σ is ~0.4°, so a perfect swipe 0.6 m inside the top corner from 22 m always goes in, one shaved 0.2 m from the corner is on target ~73% of the time, and a full-power curler is wilder still. The aim marker shows where the shooter meant it to go.

No trajectory preview.

### 3.2 Keeper flick
In the keeper view (§5.2), the swipe starts anywhere in the lower 70% of the screen. **One flick per kick; it cannot be changed.**

| Gesture | Result |
|---|---|
| **Tap** (length < 0.04 sh, < 200 ms) | **Set:** the keeper stays big in the middle. Reach is ±1.0 m lateral and 2.5 m high. Best chance to catch central shots |
| **Swipe** | **Dive to where you flick.** The flick is measured against the goal as it appears on screen and laid from the keeper's hands: sideways, flicking the on-screen width of the goal moves the hands that far (flick from the keeper to the post you see and you dive to it); up the screen counts 0.6× as much (the high camera makes the goal look flatter than it is), so a natural diagonal flick reaches the top corner and a slightly downward one goes low. A mostly upward flick is a vertical jump (hands to 2.75 m); a clearly sideways one tops out at a full-height dive (2.45 m). Within 0.5 m of the stance and below 2.5 m, it's a set |
| **While dragging** | A ring on the goal shows exactly where the hands will go (after the keeper's limits: 3.3 m reach, less at full height) |
| No input | Basic stance (±0.8 m lateral, 2.3 m high) |

The flick is read through the camera, so it dives the way it looks from whatever angle the player has orbited the view to. The client turns the hand target into the canonical keeper input (`flickForHandTarget`) that the server simulates.

**Body model** (deterministic, piecewise polynomial; no trig), drawn directly from the hitbox:
- **Ready stance:** crouched (pelvis 0.88 m, slight forward lean), feet shoulder-width apart, hands in front at waist height.
- **Stance / set tracking:** the hands follow the ball's predicted crossing on a critically damped spring. The keeper side-steps up to 0.4 m, leans, and hops for high balls. Arm length is fixed, so the reach is what the body allows; arms never stretch.
- **Dive:** load (drop 0.12 m into the legs), then spring off along a shallow arc. The arms lead toward the target and the legs trail. At full stretch the body never stops: its momentum carries it on (up to 0.3 × the dive's average speed, easing off over 0.2 s) while gravity takes over, slowly at first like the top of a jump, and it lands on its side; after a vertical jump, back on the feet.

**Dive timing:**
- Windup 0.08 s after the flick.
- Travel time to full extension: `T = 0.48 + 0.15·d + 0.15·max(0, h − 1)` s (d = lateral pelvis travel in m, h = hand height). A full low dive takes about 0.9 s from the flick.
- **Auto-timing:** an early flick is held so the dive peaks no sooner than the ball arrives (the keeper "times" the dive). Flicking early therefore only risks guessing the wrong side; it never makes the keeper land before the ball gets there. Late flicks still arrive late.
- Hold at full extension for 0.25 s, then fall to the ground.
- At full stretch, hand centres reach 3.30 m from the keeper's start x. With hand radius 0.10 and ball radius 0.11, a low corner is just reachable with a well-timed dive. A perfect top-corner shot from 25 m is out of reach (tunable with `highReachScale`).

**Reaction window:** the keeper may flick at any time from the start of the shooter's run-up until the ball resolves.
- Flicking during the run-up is a pure guess (nothing about the shot is shown yet; see §6.3).
- Waiting lets the keeper see the flight but leaves less time to reach the ball.
- Design targets (asserted by `tuningReport` in `shared/src/targets.ts`): a low-corner shot from 25 m (≈ 1.1 s flight) is saveable by a flick up to ~0.44 s after contact. Penalties (≈ 0.45 s flight) need anticipation: a flick at contact is too late, while 0.25 s early (right side) saves, as in real football.

---

## 4. Simulation

A single shared, pure TypeScript module (`/shared/sim`) is used by both the server (authoritative) and the clients (prediction and replay). It has no dependencies.

### 4.1 Determinism rules
- Fixed timestep **dt = 1/240 s**. The ball is simulated for up to 4.0 s after contact, or until it stops, leaves the play area, or enters the net.
- The per-tick step uses only `+ − × ÷` and `Math.sqrt`, which give bit-identical results across JS engines. **No `Math.sin/cos/atan/exp/pow` inside the step**, because their results differ between V8 and JavaScriptCore.
- Anything that needs trig (launch vector, spin axis, keeper dive direction) is computed **once on the server**. It is broadcast as plain numbers in the launch state, or derived from input vectors using sqrt normalisation only.
- Spin decay uses a precomputed per-tick multiplier literal (no `exp`).
- A CI test runs golden trajectories in Node and in Safari (via a test page) and compares state hashes.

### 4.2 Ball
| Property | Value |
|---|---|
| Mass / radius | 0.43 kg / 0.11 m |
| Gravity | 9.81 m/s² |
| Drag | `a = −k_d·|v|·v`, k_d = 0.0115 /m (Cd ≈ 0.22), with `v` the ball's speed through the air (its velocity minus the wind) |
| Wind | Each round of a match has its own horizontal wind both players kick in (free kicks: barely a breath in round 1, up to ~7 m/s, 15 mph, from round 5; field goals §15). Drag and Magnus act on the air speed, so a 6 m/s crosswind carries a 25 m/s shot from 20 m about half a metre sideways, a following wind carries it on and a headwind holds it up. The keeper's timing allows for it. The HUD shows an arrow (up = blowing away from the viewer) and the speed in mph; the corner flags stream with it. The AI shooter aims off for it (the harder the level, the closer its read) |
| Drag crisis | Below 10 m/s the drag is 1.9× higher, blending back to 1× by 16 m/s: slow balls hang and brake, driven balls carry |
| Magnus | `a = k_m·(ω × v)`, k_m = 0.005 (lift coefficient ≈ 0.85 × spin parameter, within measured ball data) |
| Max spin | 105 rad/s sidespin at 27 m/s, past what feet manage (studies measure ~60–110 rad/s on curled free kicks), so full curl bends ~6.9 m over 25 m where a pro's 10 rev/s curler bends ~3.9 m: the game's licence for fun. Plus 0.25× that as topspin on curlers |
| Spin decay | Time constant ≈ 4 s |
| Ground bounce | Normal restitution 0.55. Friction (μ 0.4) acts only during contact, so a steep bounce keeps 70% of its pace and a skimming drive skids on with nearly all of it |
| Rolling deceleration | 0.5 m/s² |

**Real-world checks** (asserted in the test suite against commonly reported football figures):

| Check | Sim | Expected |
|---|---|---|
| Terminal velocity | 29.2 m/s | 27–33 m/s |
| Penalty at 100 km/h to the line | 0.44 s | 0.38–0.50 s |
| Speed kept over 25 m (30 m/s drive) | 77% | 70–85% |
| 25 m free kick at ~97 km/h, flight time | 1.12 s | 0.95–1.20 s |
| Bend over 25 m, a pro curler at 10 rev/s | 3.9 m | 2.5–4.5 m |
| Bend over 25 m at the game's full curl (exaggerated for play) | 6.9 m | 6–8 m |
| Range of a 30 m/s ball struck at 35° | 52 m | 48–68 m |
| Drag, slow vs driven ball | 1.9× | 1.6–2.2× |
| Full curl vs a drive, time to goal | 11% slower | 6–20% |
| Launch angle, 22 m free kick to the top corner at 27 m/s | 15.9° | 13–21° (studies: 15–20°) |
| Soft low shot from 25 m, peak height | 0.34 m (rolls in) | ≤ 0.6 m |

**Trajectory shape** (no wall, aimed at 2.1 m, quick flick ≈ 29 m/s): from 22 m it launches at 14.5°, passes the wall line at 1.9 m, peaks at 2.4 m and arrives in 0.90 s; from 25 m, 15.5° / 2.1 m / 2.7 m / 1.05 s; a curler from 25 m launches higher (18.9°, peak 3.1 m) because its topspin pulls it down. That matches the published picture of a free kick: 24–28 m/s, 15–20° up, just over the wall and in within about a second.

Sources: Barber & Carré (2010), *The effect of surface geometry on soccer ball trajectories* (pros average ~24 m/s and ~106 rad/s on curling free kicks); Alcock et al. (2012), *Initial ball flight characteristics of curve and instep kicks in elite women's football*, J Appl Biomech 28(1) (curve kicks launch higher with more sidespin; launch angles must be held within ~3°); Bray & Kerwin (2003), *Modelling the flight of a soccer ball in a direct free kick*, J Sports Sci 21(2) (25 m/s free kick over a wall from 18.3 m); Goff & Carré (Beckham's 2001 free kick at ~36 m/s).

### 4.3 Collisions
Swept sphere tests against capsules and cylinders run every tick (the ball moves up to 0.13 m per tick).

- **Posts and crossbar:** cylinders of radius 0.06 m. The response reflects the normal component with restitution 0.65, keeps 0.9 of the tangential component, and halves the spin. The contact normal depends on where the ball strikes, so a glancing hit on the inside of the post deflects in, and a square hit bounces out.
- **Wall players:** a capsule of radius 0.22 m, height 1.85 m (plus the 0.3 m jump offset). Restitution 0.4. The ball continues afterward, so deflected goals are possible.
- **Keeper:** a compound hitbox. Torso capsule r 0.18; head sphere r 0.12; upper arm and forearm capsules r 0.07; hand spheres r 0.10; leg capsules r 0.09. It is posed every tick from the dive kinematics.
- **Net:** a ball inside the goal volume is damped to rest. This is visual only; the goal is already decided.

### 4.4 Keeper contact response
On first contact, classify the contact and resolve it:

| Contact | Condition | Result |
|---|---|---|
| **Catch** | Torso, or both hands within 0.25 m of each other, relative speed < 22 m/s, keeper not at full stretch | Ball stops: **Save `caught`** |
| **Firm parry** | Any non-catch contact that is fairly head-on (glance < 0.3, where glance = 1 − \|n · v̂_rel\|: 0 head-on, 1 grazing), or any torso/leg/head contact | Reflect with e = 0.5 plus the keeper's velocity, keep 30% of the incoming tangential velocity |
| **Weak touch** | Hand or arm contact with glance > 0.3 (a fingertip graze) | Deflect by only a small angle: keep 60–85% of the incoming speed, more for more glancing touches. **The ball keeps simulating and can still go in** (Goal `keeper_spill`) |

After contact, the sim keeps running with all collisions active (post, net, second keeper contact).

### 4.5 Outcome classification
The server runs the full sim with the launch state, wall configuration and keeper input. The outcome follows §1.2. Its result is final; clients always show the server's outcome, even if local prediction disagreed.

---

## 5. Camera and presentation

Every view is **framed by solving for pitch and field of view** for the current spot and screen shape, never by fixed offsets. An automated check over 600 random spots per role confirms the ball and the goal (or the keeper) are always on screen.

### 5.1 Shooter view
- Camera behind the ball (4 m, more for close spots), 2.2 m up so the goal shows over the wall's heads, nudged 0.6 m right of the run-up.
- Framed so the crossbar sits in the upper part and the ball near the bottom. On narrow portrait screens it widens until both posts fit.
- After contact the camera **chases the ball** up the pitch along its line, rising to 3 m: further for longer shots (a 35 m free kick is followed to ~16 m out; a penalty just steps past the ball), finishing framed on the whole goal. Its progress follows how far the ball has come (never backward, so a parry doesn't pull it back), through a spring, so it starts and stops smoothly.
- The swipe zone is the lower 60% of the screen.

### 5.2 Keeper view
- Camera high at the front of the stand behind the goal (10.5 m up, 9 m behind the keeper on the line from the ball, never further back than z = −7.6 so it never enters the stand), looking down the pitch. A portrait screen is tall, so it holds the whole kick: the shooter near the top, the flight down the middle, and the keeper and the full width of the goal across the bottom.
- It barely follows the ball (the whole flight is already in frame) and never turns to follow it into the goal below.
- Wall players occlude the ball naturally (see the wall trade-off in §2.1).

### 5.2a Player camera and ball tracking
- **Player-controlled view:** two fingers drag to orbit and pinch to zoom (right-drag and the wheel on desktop). The view orbits around the ball when shooting and around the keeper when keeping, saved separately per role, so a preferred view sticks. A reset button appears once the view has been moved. Aiming and keeper flicks are read through whatever camera is in use.
- **Ball tracking in flight:** the look-at point is pulled toward where the ball will be 0.25 s ahead (from the recorded flight), harder as it nears the goal, so a fast ball can't leave the frame. The pull fades in over 0.35 s after contact and runs through a critically damped spring (ω = 7 rad/s), so the camera eases in and out with no snap, whatever the ball does. The keeper's camera stops following at the goal line rather than swinging round into the net.
- **Smoothing:** the player's orbit and zoom glide to where the fingers put them, as do role changes.
- **Cuts:** the replay cuts straight to the reverse angle; gliding round to it would whip the view through 180°.

### 5.3 Sequence per kick
1. **Spot reveal** (2 s): an aerial fly-in showing the spot and category ("PENALTY", "EDGE OF THE BOX", "LONG RANGE").
2. **Wall setup** (keeper only; the shooter sees "Keeper setting the wall…").
3. **Aim:** the shooter sees the shot clock ring. The keeper sees the shooter standing over the ball ("Shooter lining up…"); none of the shooter's input is shown.
4. **Run-up** (1.2 s, a generic animation that is **identical for every kick**, so nothing is revealed early).
5. **Contact and flight**, with the keeper's reaction window.
6. **Result:** the banner comes up 0.12 s after the kick is decided, **over the live action**: play runs on for 1.6 s more (visual only) so the keeper finishes the dive and lands, a caught ball stays in the gloves, and a missed or parried ball flies on and bounces to rest. A goal goes into a net that gives (shared/src/net.ts, stepped like the sim): the back and sides are a damped spring that stiffens as it stretches and gives back only a fifth of what it took, and the mesh grips the ball while it's pressed in, so a 25–32 m/s shot bulges the back of the net 0.4–0.6 m, is let go with a metre or two a second left, drops to the grass, bobbles and rolls to rest in the goal. The back netting is drawn wrapped round the ball while it's pressed in and springs back with a wobble when it lets go. Goal shows a "GOAL" banner; miss/blocked shows the caption.
7. **Replay:** reverse angle from above and behind the goal (a side-on camera can't fit the flight on a portrait screen). Slow motion around close calls (woodwork, keeper or wall touch, or a shot into the corner or under the bar). Tap to skip.
8. **Role swap** with a short transition: "YOUR TURN TO SHOOT" / "GET IN GOAL".

### 5.4 HUD
- Two rows of 5 kick dots (plus sudden-death dots): goal ● green, non-goal ✕ red, pending ○. Each also shows a text or shape so meaning does not rely on colour alone.
- Nicknames, a role badge, a timer ring, and a round label.
- **What's at stake:** under the role badge, any kick that can decide the match says so (in regulation too): SCORE TO WIN / SAVE TO WIN in gold, MUST SCORE / MUST SAVE in red (field goals: MAKE IT TO WIN, A MISS WINS IT, MUST MAKE, NEED A MISS), pulsing. While one is lined up the crowd hushes to a nervous murmur, and lets go at the strike.
- Safe-area insets (`env(safe-area-inset-*)`) are respected for the Dynamic Island and home indicator.


### 5.5 The coin toss (vs AI)
At midfield (the centre spot; the 50-yard line for field goals) before the first kick: the referee (in black for soccer; stripes and a cap for football) between the two captains, each with his kicker at his shoulder. The camera comes down from high to stand with them; the captains step in and shake hands; the referee shows the coin (big and gold, a profile for heads and a star for tails). The player calls it (two buttons, 5 s, or it's called heads for them); the referee flicks it up off his thumb, it turns over and over (glinting in the floodlights) with the camera following it up, lands on the grass, bobbles and rattles flat; the camera drops in to see it; the referee points to the winning captain, who pumps a fist while his kicker claps, and the other two stand hands on hips. The crowd cheers the player's win and goes quiet at the AI's. Then the winner chooses: the player gets two buttons (Shoot first / Keep first; field goals: Kick first / Defend first; 5 s, or they shoot first); the AI takes the first kick 70% of the time. The banner says who kicks first and whose choice it was.

### 5.6 Sudden death
Level after five, the game stops for it: the crowd falls silent, black letterbox bars close in, and SUDDEN DEATH slams down in red chrome with a flash and a jolt as the ground erupts and the flashbulbs go, over a low shot from behind the goal rising to the next spot. From then on the screen's edges pulse red on a double heartbeat, the round label goes red, the stadium screens say so, the shot clock is 7 s instead of 10, and every kick is called out as must-score or to-win (§5.4) with the crowd hushed while it's lined up.

---

## 6. Multiplayer (real-time)

**Built (v1, friends):** the server is `server/` (Node 20, `ws`), one process serving the built game and the matches on one port; rooms in memory. The protocol is `shared/src/protocol.ts` (the messages below, as built) and the match engine `server/src/room.ts` (tested headless in `server/test/room.test.ts`, a whole match on fake timers). The client side is `client/src/net/online.ts` (the connection: clock sync, reconnect, an ordered inbox) and `client/src/game/online-session.ts` (the match, reusing the AI match's scenes). Differences from the plan below: no Quick Match queue yet (friends only); the friend who joins calls the toss and the winner chooses to kick or keep first (§5.5); on a reconnect the kick in play starts over rather than resuming mid-phase; the shooter's view isn't held 150 ms behind (the keeper's flick re-sims the shooter's playback as it arrives, as a local flick does); names are 2–16 letters, unfiltered; no connection-quality icon yet.

### 6.1 Architecture
- **Authoritative server** holds the match state machine, runs the sim, and validates inputs. It is backend-agnostic: a reference implementation in Node.js with WebSockets (`ws`), with in-memory rooms and one match per room. The protocol is plain JSON over WebSocket, so it can be re-hosted on any platform that supports WebSockets.
- **Clock sync:** NTP-style pings on connect and every 10 s give the client an estimate of the server-time offset and round-trip time (RTT).

### 6.2 Match state machine
```
LOBBY → COIN_TOSS → ROUND_INTRO → [WALL_SETUP] → AIM → RUNUP → FLIGHT → RESULT → REPLAY
          ↑                                                                    │
          └──────────── next kick (swap roles; new spot if new round) ─────────┘
                                                    → MATCH_END (rematch offer)
```

### 6.3 Kick timeline and information hiding
1. Shooter releases a valid swipe. The client sends `kick_input` {u, L, p, c, swipe duration}. The server validates ranges, computes the **launch state** (position, velocity, spin vector), and stores it.
2. The server immediately broadcasts `kick_committed` {runupStartServerTime}. **No shot data is included.** Both clients start the generic 1.2 s run-up.
3. The server sends `kick_launch` {launchState, contactServerTime} to each client, timed to arrive at contact (it sends at contact − RTT/2 for that client). The keeper's client therefore learns the trajectory no earlier than the ball is struck.
   - If the launch arrives late, the client holds the strike pose until it arrives (≤ 1 frame at typical latency).
4. The keeper flicks. The client sends `keeper_input` {vector, duration, flickTick}. flickTick is the sim tick relative to contact (tick 0) and is negative during the run-up. The client starts the dive locally immediately (prediction).
5. **Anti-cheat timing check:** the server checks that flickTick is consistent with when the message arrived (RTT/2 ± 120 ms tolerance). A flick claiming to be early cannot arrive after the trajectory was revealed. If it is inconsistent, the server uses the tick implied by the arrival time instead (always worse for the keeper).
6. The server relays the keeper input to the shooter. The shooter's client runs the flight 150 ms behind real time, so the dive usually appears in sync without snapping.
7. When the sim resolves, the server broadcasts `kick_result` {outcome, tag, keeperInput, wall, score}. Clients re-sim locally for the replay, which is deterministic and identical on both phones.

### 6.4 Messages
As built (`shared/src/protocol.ts`): client → server `hello` {name, token?}, `create` {mode}, `join` {code}, `leave`, `ping` {c, rtt}, `call` {side}, `choose` {kickFirst}, `wall`, `kick` {input}, `keeper` {input}, `emote` {kind}, `ready`, `rematch`; server → client `welcome` {token}, `room` {code, mode, seat, names}, `pong` {c, s}, `opponent` {connected, name}, `toss_call` {caller, deadline}, `toss` {call, side, winner, deadline}, `toss_choice` {chooser, kickFirst, firstShooter}, `kick_start` {n, round, shooter, spot, wind, cam, clock0, aimMs, kicks}, `wall` {wall, deadline}, `committed` {contact, launch?}, `launch` (to the keeper, at contact), `keeper` (the flick, to the shooter), `result` {launch, keeper, wall, outcome, tag, scored, kicks}, `emote`, `end` {winner, kicks, forfeit}, `rematch` {seat}, `error`. The original plan:

| Client → Server | Server → Client |
|---|---|
| `hello` {token?, nickname} | `welcome` {token, playerId} |
| `queue_join`, `queue_leave` | `match_found` {matchId, opponent, firstShooter} |
| `room_create` / `room_join` {code} | `room_created` {code, shareUrl} |
| `wall_set` {offset, size} | `round_start` {round, spot, category, wallAllowed, maxWall} |
| `kick_input` {u, L, p, c, durMs} | `phase` {name, deadlineServerTime} |
| `keeper_input` {vx, vy, durMs, flickTick} | `wall_placed` {offset, size} |
| `skip_replay`, `rematch` | `kick_committed`, `kick_launch`, `keeper_relay`, `kick_result` |
| `ping` | `match_end` {winner, score}, `opponent_status` {connected}, `pong`, `error` |

### 6.5 Matchmaking and rooms
- **Quick Match:** a first-in-first-out queue. If no opponent is found within 15 s, offer an **AI opponent, clearly labelled "AI"**, or keep waiting.
- **Play a Friend:** create a room, which gives a 6-character code and a link (`/r/CODE`) shared through the Web Share API. Rooms expire after 10 minutes unused. Opening the link joins directly.
- **Rematch:** both players tap Rematch within 15 s, and a new coin toss starts the next match.

### 6.6 Disconnects and inactivity
- 20 s reconnect window. The match pauses (timers frozen) and the opponent sees "Opponent reconnecting… 17". Reconnecting resumes the current phase.
- No reconnect within 20 s: forfeit, and the opponent wins.
- Two consecutive shot-clock timeouts by the same player: forfeit.
- A connection-quality icon shows when RTT > 200 ms.

### 6.7 Identity (v1)
- Guest only: nickname (3–16 characters, profanity-filtered) and a server-issued signed token stored on the device.
- No email, no accounts, no personal data.
- Stats (matches, wins, goals, saves) are stored locally on the device only.
- Unranked.

---

## 7. Single player

### 7.1 AI opponent (practice, bot fallback, tutorial)
| | Easy | Medium | Hard |
|---|---|---|---|
| Keeper reaction delay | ~450 ms | ~320 ms | ~240 ms (± random spread) |
| Keeper prediction | Ignores curve | Partial curve | Full prediction, with small aim error |
| Penalty guess (pre-contact dive) | 40% | 70% | 80% |
| Shooter aim misjudgement (σ, plus the strike error) | 0.8 m | 0.45 m | 0.25 m |
| Shooter power error (σ) | 0.12 | 0.08 | 0.05 |

- **Penalty guess:** dives 0.2–0.6 s before contact. It reads the run-up well enough to get the side right 55% of the time (60% on hard), diving to roughly where the ball goes; otherwise it dives the wrong way.
- **Shooter AI:** picks a target (biased toward corners and away from the wall) and a curl, solves the start line for that curl (`kickInputForTarget`), adds its misjudgement of the aim point (σ 0.8/0.45/0.25 m), and then its strike carries the same strike error as a player's.
- **Balance check:** a simulated human shooter (random corners and heights, 0.45 m aim noise, random power and curl) against each AI keeper scores, with strike error on (medium keeper): penalty 77%, edge of the box 37%, long range 36%. About 40% of its edge-of-the-box shots hit the wall (it aims low half the time). Most misses outside the box are the wall, which is beaten by going over it softly, or round it with curl.
- **Wall AI:** max size, covering the near-post side.
- The AI sends the same `kick_input`/`keeper_input` messages through the same sim. No special rules.

### 7.2 Tutorial (first launch, replayable from the menu)
1. Shoot into an empty goal from the penalty spot (aim and power).
2. Hit the top corner (height).
3. Curl one around a wall (curve).
4. Beat an Easy keeper.
5. Keeper: tap to stay set for a central shot.
6. Keeper: dive to save a shot to the corner.
7. Keeper: place a wall.
8. "You're ready." Offer Quick Match or Practice.

Each step shows an animated finger hint and retries until it is passed (with an option to skip after 3 attempts).

### 7.3 Practice
- Choose the role (shoot / keep / alternate), the spot category (or a specific random spot that can be re-rolled), and the AI difficulty.
- Optional **trajectory trace** after each kick, for learning; it is never shown in matches.
- Unlimited kicks and no scoring. Works offline.

---

## 8. Graphics

**Direction: an early-2000s console football game** (a throwback, not a modern render): low-poly players with rounded torsos, a wrap-around shirt texture (V collar, crest, number on the back), shoulder, elbow and knee joints, faces, ears and hair, and a little Phong sheen, a cross-mown floodlit pitch with a scuffed goalmouth, perimeter advertising boards (invented sponsors only), a closed bowl of two-tier stands (they meet at the corners) with a low-contrast pixel crowd in home-colour clumps under lit roofs. **The crowd is alive:** every supporter bobs on their own rhythm (a shader shifts each texture cell), more of them and higher when excited; flags wave in the front rows; fan banners hang on the stand fronts; camera flashes twinkle, a storm of them for a goal. One excitement level drives all of it, and the crowd audio with it: it builds through the run-up and erupts for a goal, then calms. **Branding:** rotating LED perimeter boards (each sponsor panel holds for 7 s, then the boards slide on together), the stadium's name (FREE KICK ARENA) along the tier fronts, and big screens on two roofs showing the round and score. All teams, players and sponsors are invented. After the result, the ball still collides with the net from outside, the boards and the stand fronts, and lands in the crowd rather than passing through. Plus floodlight towers with glare, saturated colours without a filmic tone curve, and a slanted navy-and-gold broadcast overlay with italic condensed type.

**It's a PS2 game, on purpose.** The look is a deliberate homage, so it has to read as a choice rather than a budget:
- **The console** (client/src/world/retro.ts): the scene is drawn into a small framebuffer (one line per two screen points, one pixel per 1.25 points along the line, at most 640 × 480) with no anti-aliasing; a wide, smeary bloom from a half-size bright pass; lens flares off the floodlight lamps (a hot core, a long horizontal streak and coloured ghosts back through the middle of the screen, hidden when something's in front of the lamp, from the frame's depth); a little extra saturation and contrast; and the result squeezed into 15-bit colour with a 4×4 ordered dither, like the console's 16-bit framebuffer.
- **The TV:** that frame is shown as a CRT would: each line a glowing beam (Gaussian across the line, fatter where it's bright, so bright lines bleed together and dark ones show gaps), soft along the line like a composite signal with red and blue a touch apart, an aperture-grille mask (RGB phosphor stripes), and darker toward the edges and corners. Settings → Picture switches between *Retro 480i* (default) and *Clean* (full resolution, no filter).
- **The models:** low-poly on purpose (8-sided limbs, 12-sided torsos, 12 × 10 heads) with painted kits: creases and shading baked into the shirt textures, a shiny polyester sheen. The match ball is a real 32-panel ball (12 black pentagons, 20 white hexagons) with dark seams between the panels.
- **People move like people:** anyone waiting breathes and shifts their weight on their own rhythm (kicker, wall, holder, the line and the rush before the snap).
- **Floodlight shadows:** no shadow maps. Each player and the ball throws four soft smudges, one away from each tower, crossing under the feet, fading and spreading as they leave the ground (client/src/world/shadows.ts).
- **The console bits:** a black *LOADING…* screen with a tip, a *PRESS START* title (chrome lettering, a blinking prompt, a made-up 2004 copyright line; the tap also wakes the audio), a replay wipe (a striped band and the spinning crest sweep across, and the camera cuts behind it), and at the end of a match a *Saving data… do not remove the MEMORY CARD (8MB)* notice.

### 8.1 Stack
- **TypeScript + Vite + Three.js** (WebGL2).
- Models are glTF/GLB, compressed with meshopt or Draco. Textures are KTX2 (Basis Universal).
- Monorepo: `/client`, `/server`, `/shared` (sim, protocol types, constants).

### 8.2 Look
"Grounded but gamey": a bright broadcast-style stadium at dusk or night under floodlights.
- Physically-based materials, one directional light plus an environment map (HDRI) for image-based lighting.
- No shadow maps: floodlight blob shadows under the players and the ball (§8); baked lighting for the stadium.
- Pitch with mowing stripes done in a shader, and painted lines.
- Crowd as instanced animated billboards, in two tiers, with simple bobbing and a celebration state.
- Goal net as a mesh whose back netting wraps round the ball while it's pressed in and springs back with a wobble (§5.3).
- Ball has a motion trail at high speed. Bloom is subtle and off on low-performance devices.

### 8.3 Assets — free-use only
- Every asset is logged in `ASSETS.md` with its source URL, author and licence.
- Allowed licences: **CC0** preferred, CC-BY acceptable (with an in-game Credits screen).
- No assets that require a paid licence. No real clubs, players, crests or sponsor marks.

| Need | Source plan |
|---|---|
| Player / keeper characters | CC0 rigged low-poly humanoids (e.g. Quaternius), retextured with original kits. Kit colours are picked per player in a match (home/away contrast) |
| Run-up, strike, celebration animations | CC0 animation libraries where available. Otherwise author them in code as keyframed bone poses |
| **Keeper dives** | Unlikely to exist free with the right fidelity, so they will be **procedural**: keyframed poses blended along the dive path, plus two-bone IK reaching the hands toward the dive target. *Highest art risk; prototype in M1.* |
| Stadium, goal, ball, pitch | Built in code or modelled simply. CC0 textures (ambientCG, Poly Haven) and a CC0 HDRI (Poly Haven) |
| Sounds | CC0 sources (Kenney audio packs; Freesound filtered to CC0), or synthesised |

### 8.4 Performance budget (iPhone target, 60 fps)
| Item | Budget |
|---|---|
| Frame time | ≤ 14 ms on the oldest target iPhone (headroom under 16.7 ms) |
| Draw calls | ≤ 150 |
| Triangles on screen | ≤ 300k |
| Render resolution | devicePixelRatio capped at 2 (iPhones are 3×) |
| Texture memory | ≤ 150 MB GPU |
| Initial download | ≤ 15 MB, cached by the service worker afterwards |
| Time to interactive (cached) | ≤ 2 s |

**Adaptive quality:** if the average frame time is above 17 ms for 2 s, step down in order: bloom off → shadow map 512 → render resolution 1.5× → crowd density halved.

---

## 9. Audio

The Web Audio API mixes **recorded samples** (client/public/sfx; sources and licences in sfx/CREDITS.txt and on the Settings screen): each ground's own live crowd (soccer-default-1/2.mp3, nfl-default-1/2.mp3) and its own cheer (soccer-goal-cheer.mp3, nfl-kick-good.mp3), supplied by the developer as 320 kbps MP3s (~5.4 MB); the referee's whistle, the strike, glove, post, turf/board bounces and the net (small WAVs). The effects and both cheers load first (so a cheer is never missing), then the current ground's crowd, then the other's; if a ground's cheer still isn't in, the other ground's stands in. Audio unlocks on the first tap and suspends when the app is backgrounded. `navigator.audioSession.type = 'ambient'` where supported, so the game mixes with the user's music and respects the silent switch. No commentary. The crowd's level and the stadium visuals react together (§8.2).

**The mix.** The recordings come in at very different volumes (the NFL ones ~10× quieter than the soccer ones), so everything is levelled as it loads: each stretch of crowd bed to the same loudness (RMS 0.12), each cheer by its loudest second (RMS 0.4), and the gains in the code are relative to that. The crowd bed runs through its own bus: a low-pass that opens as the crowd gets going (2.4 kHz → 11.4 kHz), its level (0.12–0.44 with the excitement), a gentle compressor (−26 dB, 2.5:1) to keep its own swells in check, and a duck. Reactions and effects go straight to the master, which a compressor (−10 dB, 4:1, soft knee) keeps from clipping. Every one-shot fades in and out over a few milliseconds (no clicks cutting into a recording); a change of ground crossfades the two crowds over ~1 s.

| Sound | Trigger | Variation |
|---|---|---|
| Crowd (each ground's own live recordings) | Always | Swells and brightens with the excitement; quieter under the visitors' kick; hushed for a decisive kick |
| Cheer (each ground's own) | A goal, a good kick, a save, a visitors' miss | Full, relieved, or small and far off for the away end |
| Whistle | Start of each kick | — |
| Kick thump | Ball contact | Pitch and volume scaled by power; 3 samples |
| Ball whoosh | Flight | Volume follows ball speed; panned in 3D |
| Post / crossbar clang | Woodwork hit | Pitch and volume by impact speed; 3 samples |
| Glove save slap | Parry or weak touch | Strength by contact type |
| Catch thud | Catch | — |
| Wall thud | Wall block | — |
| **Net swish** | Goal (ball enters the net) | — |
| Crowd reactions | Result | From the home crowd's side, see below |
| UI | Taps, countdown ticks, match win/lose stings | — |

Settings: sound on/off (menu Settings and the 🔊 button in game), remembered.

### 9.1 The crowd (client/src/audio/sound.ts)
The crowd is **the player's home crowd**, and it's all real recordings (no synthesized stadium sounds). Each ground has its own: a soccer stadium (singing, chanting) and an NFL stadium.
- **The bed** plays the ground's recordings as they were recorded: each straight through (its longest clean stretch: the MP3 encoder's padding at the ends and any dropout, all four have one in their first two seconds, are found when it loads and left out), levelled as a whole so nothing jumps inside it, then a 3 s equal-power crossfade into the other, and round again. The first starts from a random point. The home crowd is a touch quieter (80%) while the visitors line up.
- **The cheer** for a goal or a good kick is the ground's own. Both recordings open with an edit (a dropout, and a thump in the NFL one), so they're played from just after it, with the roar arriving a beat after the ball goes in or the officials signal; the soccer one ends at full cry, so its last 1.4 s fades out while the bed (lifted with the excitement) takes over. The bed is ducked to half under a cheer so the two don't pile up, and comes back up over 2 s as the cheer fades.
- **Going against them**, the ground goes quiet: the whole bed drops to 18% (quicker for a near thing, held longer for a shank) and murmurs back up over 2.6 s. There's no groan or boo sample: every reaction is one clear sound from the ground's own recordings. A kick that could decide the match is lined up under a hush (the bed at 30%), let go at the strike. Sudden death's title card: near silence, then the cheer erupts.
- **Reactions**, by who it was good for, how near, how wild (a free kick is near if it hit the woodwork, was fingertipped or missed by under 0.7 m, wild if short or over 3 m off target; a field goal near if it doinked, hit the cable cam or missed by under 0.8 m wide or 0.6 m short, wild if blocked, over 4 m wide or 2.5 m short):
  - any goal or made field goal: the ground's cheer, full for the player's (and for a save of theirs), a little less for the AI's (the away end and the neutrals);
  - the opposition misses: the cheer (relief), louder if it was close;
  - the player misses, or is saved: the ground goes quiet (above).
- **Taunts** (§16): the player's get a quick cheer (just the peak of the ground's cheer), the AI's a moment's quiet; at most one every 1.5 s however fast they're spammed.

---

## 10. Web app shell (PWA)

- Web app manifest: `display: standalone`, `orientation: portrait`, a theme colour and icons. Include `apple-touch-icon` and the `apple-mobile-web-app-*` meta tags.
- The service worker (production builds only) fetches the page fresh when online and falls back to the cached copy offline; hashed assets are cache-first. Everything single-player works offline; multiplayer requires a connection.
- **Install prompt:** iOS has no automatic install prompt, so on iPhone in a Safari tab the main menu shows a one-time tip explaining *Share → Add to Home Screen*. It can be dismissed, and the game remains fully playable in a Safari tab.
- **Portrait only:** in landscape on a phone, a full-screen prompt asks to turn the phone upright.
- Prevent pinch-zoom, double-tap zoom, rubber-band scrolling and text selection on the game surface.
- **Known iOS web limits (accepted for v1):** no haptics (no vibration on iOS), no push notifications needed (real-time only), no fullscreen in a Safari tab (solved by the home-screen app).

### 10.1 Screens
1. Splash / loading (until the stadium's first frame is on screen)
2. First run: **How to play** (shoot, curl, chip, keep, each with an animated swipe), then the menu. Nickname comes with online play (M3)
3. Main menu: **Play vs AI**, **Practice**, Online (coming soon), **How to play**, **Settings**
4. Matchmaking (spinner, cancel, AI fallback after 15 s)
5. Friend room (code, share button, waiting state)
6. Match (§5)
7. Match end (winner, kick-by-kick summary, Rematch, Menu)
8. Settings (sound, reset camera views, a note that every team, player and sponsor is fictional)
9. In game: ✕ asks before leaving a match; 🔊 mutes; ⟲ resets a moved camera; a broadcast REPLAY tag during replays

---

## 11. Testing

- **Sim unit tests:** golden trajectories, post-collision cases (in/out by angle), keeper contact cases (catch / parry / spill-in), outcome classification.
- **Cross-engine determinism:** hash comparison between Node and Safari (§4.1).
- **Tuning harness** (desktop, M0): debug-render the sim, with sliders for every constant, trajectory traces, and keeper reach envelopes. Pass/fail checks for the targets in §3.2 and §4.2.
- **Server:** bot-vs-bot soak test (hundreds of concurrent matches), latency and jitter injection (50–300 ms RTT, packet delay), and disconnect/reconnect scripts.
- **Device testing** on the 3 target iPhone generations plus one mid-range Android: frame time, memory, thermals over a 10-match session.

---

## 12. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| M0 | **Sim + tuning harness** | Deterministic sim with ball, posts, wall, keeper hitbox and outcomes. Tuning targets met. Determinism test passes in Node and Safari |
| M1 | **Playable on one device** | Shooter and keeper flicks, both cameras, play vs AI, Practice mode, placeholder art. Procedural dive prototype. Playtested on iPhone — *is the flick fun?* |
| M2 | **Art and audio** | Stadium, characters, animations, crowd, net, all sounds, replays, HUD. Performance budget met on target devices |
| M3 | **Multiplayer** | Server, protocol, Quick Match, friend rooms, AI fallback, reconnect/forfeit, anti-cheat timing check. Soak and latency tests pass |
| M4 | **Shell and polish** | Tutorial, PWA install flow, settings, credits, offline practice, adaptive quality |
| M5 | **Beta** | External playtest; tune spot weights, dive timing and AI difficulty from match data |

---

## 13. Out of scope for v1
Accounts and sign-in, rankings/leaderboards, cosmetics/customisation, monetisation, chat/emotes, spectating, commentary, haptics, async play, pass-and-play.

## 14. Decisions taken in this spec (confirm or change)
1. **The keeper also chooses wall size** (0 to max), not only position. Wall players block the keeper's view, so this is a real trade-off.
2. **Shot clock expiry = Miss.**
3. **Run-up is identical for every kick**, so keepers can't read body language. This keeps hidden information fair, but it also means penalties are mostly a guessing game for the keeper.
4. **Spot weights:** penalty 35% / outside box 40% / long range 25%. Every kick awarded inside the box is a penalty from the spot.
5. **Inside-the-box spots have no wall** (your answer specified walls only for outside the box).
6. **Kick power also adds lift** when overhit (p > 0.92), to produce the over-the-bar miss.

---

## 15. Field goals (second game mode)

A 1v1 kicking duel with **no saves**: whoever makes more field goals wins. Same match rules (§1.1: 5 kicks each, alternating, early finish, sudden death), same swipe and strike model (§3.1), same AI difficulties. Everything that makes a kick hard is a question for the flick (no meters or timing bars): distance (power), the angle from the hash (aim), the wind (aim off or bend it), the rush (loft), and the broadcast's cable cam swinging across the field in the ball's path (pick your moment, go over or under it, or bend it round).

- **Stadium:** the ground turns into an American football stadium: a gridiron (posts on the end line at z = 0, a painted end zone, yard lines every 5 yd with numbers every 10, high school hashes, pylons), a crowd in team jerseys with towels, foam fingers and signs, and US-style fan banners. The players wear football gear (helmet and facemask, shoulder pads, pants to the knee, numbers front and back). The soccer pitch, goal, keeper, flags and corner flags are hidden.
- **Posts:** yellow H-posts: crossbar 3.05 m (10 ft), uprights 5.64 m apart (18 ft 6 in) rising 10.67 m above the bar, a gooseneck behind with its arm under the bar. Ribbons on top of the uprights stream with the wind.
- **Good** = the ball crosses the plane of the posts above the bar and between the uprights (extended upward). Kicks hit the uprights, crossbar and gooseneck like the soccer frame (§4.3): a **doink** can go in or bounce out. **Short** = under the bar, or down before reaching it. Wide left / wide right are from the kicker's view. **Blocked** = a rusher got a hand to it. **Cam** = it clattered the cable cam (no good).
- **Spots:** both players kick from the same spot each round: on the **left or right hash** (high school hashes, which split the field in thirds: 53 ft 4 in apart, ±8.13 m; wider than college's 40 ft and the pros' 18 ft 6 in, to make the angle a real question) or, one round in twelve, the middle, so nearly every kick comes in at a sharp angle. Further out each round: 30–36 yd in round 1, 54–60 by round 5, up to 63 in sudden death (field goal distance = line of scrimmage + 7 yd hold + 10 yd end zone, measured to the posts).
- **Wind:** each round has a wind both players kick in, light early and up to ~9 m/s (20 mph) later, from any direction. Drag and lift act on the ball's speed through the air, so a crosswind carries it sideways, a headwind knocks it down, a tailwind carries it. The HUD shows an arrow (up = blowing toward the posts) and the speed in mph; aim into it.
- **The view:** behind the kicker, dead in line with the middle of the uprights (from the hash too).
- **Following the ball:** a football is small and brown against a night sky and a dark crowd, so in flight it's drawn bigger the further it is from the camera (never under ~10 rows of the retro frame; a PS2-era cheat), glows a little, and leaves a short warm streak (a camera-facing ribbon through the last 0.6 s of its path, tapering and fading, additive so it catches the bloom).
- **The kicker:** set three steps back and two across, at about 30° to the kick, until the holder catches the snap; then a short jab step with the right foot, a long one onto the planted left beside the ball, the right leg cocked behind (heel up) and whipped through almost straight, swinging on up above the waist and a little across, the body leaning back and away from it with the left arm flung out for balance; a hop forward off the plant foot, and down onto the kicking foot to watch it go.
- **The holder:** kneels on his right knee at the kicker's right of the spot, facing the snapper (turned in toward the spot), both hands held out as the target; catches it, brings it down and holds it on its tip with a finger of his left hand (leaning out over it, the right hand on his thigh); whips the finger away as the kicker swings through, and comes up onto his knee to watch.
- **The snap and the hold:** the unit sets (snapper and four linemen on the line, the holder kneeling 7 yd behind it at the kicker's right). There's no waiting for a snap: the kicker's swipe is the nod that calls for it (the shot clock still runs; run it out and it's *Delay of game*, no good). The ball is snapped (≈ 0.36 s to the holder's hands), spotted on its tip by 0.55 s, and kicked a fixed **operation time** of 1.25 s after the swipe (real units aim for ≈ 1.3 s).
- **The rush** (seven defenders, posed straight from the sim's model, which is deterministic and part of the replayed result):
  - The five in the middle start low, fight into the blockers (hands on their chests), then each loads and jumps on his own read: a real ballistic jump (0.48–0.7 m, taking off 1.12–1.3 s after the snap, peaking 1.4–1.65 s, as kicks cross the line), arms going up into a loose V as he leaves the ground (elbows soft, one hand higher), knees tucking in the air, hips sinking to absorb the landing, arms coming down after. Hands reach ≈ 2.04 m standing with arms up plus the jump (≈ 2.75 m at best), so a kick struck lower than ≈ 26° is blocked at the line, and steeper kicks need more power to make the distance. The blocking capsule runs from the waist to the fingertips.
  - The two off the edges start in a three-point stance, accelerate (6.5 m/s² to 7.2 m/s) round the end at the kick point with a real stride (step length grows with speed, the cycle runs off the distance covered so feet don't skate, knees up on the swing, arms pumping against the legs, leaning into the acceleration), and dive across in front of the kick 1.45 s after the snap, landing on their fronts. The ball's long gone.
- **The cable cam** (from round 2: 70% of round 2s, every round after; practice too): the broadcast's camera pod hangs on four wires from the roofs and swings across the field and back, easing at each end (a triangle wave eased with a cubic: no trig, it's part of the deterministic sim). It's hung where a standard kick (the lowest that clears the rush) would be, 35–65% of the way to the posts, within ±0.4 m of its height, swinging ±1.8–4 m about its line with a period of 4.5–7.7 s (wider and quicker in later rounds). The pod is a 2 m capsule (radius 0.5 m) across the field; hit it and the kick is no good. The round has its own clock and the cam swings from the moment the round is revealed; the setup records the clock at contact, so the replay is exact. So the swipe has to allow for where the cam will be 1.25 s + the flight later: wait for it to swing away, loft it over (more power), keep it under (only just over the hands), or bend it round. A standard kick struck at a random moment hits it ~20–40% of the time.
- **Aim limits:** field goals can be aimed up to 20 m high and struck up to ≈ 54° (free kicks: 5 m, 34°), so a weak strike from long range drops short. The read-out after the kick shows speed (mph), launch angle and any bend.
- **The officials:** two referees (striped shirts, black pants, white caps) stand a pace behind the plane of the posts, one under each upright, turned a little toward the ball. They watch it in, then 0.3 s after the kick is decided (through the plane, off the woodwork, blocked, down short) give the call: both arms straight up for good; arms scissoring across the chest for no good. It replays with the kick.
- **AI kicker:** picks the lowest aim that still clears the line (≈ 27°), allows for the wind as well as its read lets it (Easy reads it worst), and with the cam up waits for a moment when the kick it means would miss it (better kickers check a window either side; weaker ones sometimes check coarsely), then kicks with its usual aim and power errors and the same strike error as a player. Make rates (medium) are tested to stay above 90% in round 1 and at least 35 points lower in sudden death (measured: ~100% in round 1, ~97% in rounds 2–3, ~78% in round 4, ~48% in round 5, ~45% in sudden death) (NFL: ~99% under 30 yd, ~80% from 40–49, ~70% from 50+).
- **Menus:** Play vs AI and Practice each choose *Free kicks* or *Field goals*. Field goal practice is kicking only, from a random round's distance and wind.

## 16. Taunts

While the opposition lines up, the player can taunt them: three buttons along the bottom of the screen (an icon and a word each). They're made to be **spammed**: each press (on the touch, not the release) cuts straight into that taunt, blending from wherever the last one was over 0.15 s, and the figure only eases back to its stance 1.6 s after the last press. It's for show: the kick itself doesn't change. Every taunt is big, whole-body and readable from the camera:
- **Keeper** (free kicks, when the AI shoots): *Jelly legs* (knees knocking, arms flapping, head going), *Bar slap* (two leaps off both feet, slapping the crossbar), *Star man* (arms and legs spread wide, bounding side to side across the goal with a hop on each landing). The shooter takes 2.6–3.8 s over it and waits for a taunt to finish before running up, for 2 s at most (so spamming can't stall the game).
- **Gunner** (field goals, when the AI kicks; the edge rusher on the right of the screen): *Hype* (jumping on the spot, fists punching up in turn), *Airplane* (arms out like wings, banking left and right, weaving), *War dance* (high knees stomping, fists pumping with them). He stands up out of his stance for it and gets back down; the AI kicker gives it at least 3.2 s, then waits for him (2 s at most) and for the cable cam's next gap.
- **The AI** has a go too: while the player lines up there's an even chance its keeper or gunner fires off a burst of two to four taunts, starting 0.9–2.4 s in, with a caption. If the player goes mid-taunt it fades out over the first moment of the run-up.
- Each taunt is a pose built on the figure (client/src/world/figure.ts, emoteJoints and poseEmote), eased in at the start of a run of presses and out after the last, and the crowd reacts (§9.1).
