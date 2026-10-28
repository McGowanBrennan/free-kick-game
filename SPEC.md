# Free Kick Duel — Game Spec (v1)

A real-time 1v1 free kick contest for mobile web. Players alternate between shooting and keeping. Each player takes 5 kicks; ties go to sudden death. Every action is a single flick.

- **Platform:** mobile web, installable as a home-screen web app (PWA). Primary target: the latest 3 iPhone generations on iOS Safari. Must also run on recent Android Chrome and desktop browsers (desktop is for development; mouse drag stands in for flick).
- **Frame rate:** locked 60 fps target.
- **Orientation:** portrait only.

---

## 1. Match rules

### 1.1 Format
- Two players, A and B. A coin toss (server RNG) decides who shoots first.
- **Round** = A shoots / B keeps, then B shoots / A keeps. Both kicks in a round use the **same spot**.
- **Regulation:** 5 rounds (5 kicks each).
- **Early finish:** the match ends as soon as one player cannot be caught. Example: A leads 3–0 after A's 4th kick, B has 2 kicks left, so A wins. The check runs after every kick.
- **Sudden death:** if level after 5 rounds, play extra rounds with a new random spot each round. The same shooter order holds. A round decides the match when one player scores and the other does not. Rounds repeat with no limit.

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
| Aim (shooter) | 10 s | Kick recorded as **Miss (`shot_clock`)** |
| Keeper reaction | Until the ball resolves | No flick means the keeper stays in the basic stance (smaller reach than "set") |
| Result + replay | 4 s (skippable when both players tap) | Auto-advance |

---

## 2. Kick spots

The server generates one spot per round from a seeded RNG. Spots are mirrored left/right with equal probability.

Coordinates: origin at the centre of the goal line on the ground. **+z** points out into the field, **+x** is right as seen by the shooter, and **+y** is up. All units are SI.

| Category | Weight | Region | Wall |
|---|---|---|---|
| Penalty | 15% | Fixed (0, 11) | No |
| Inside the box | 20% | z ∈ [8, 16], \|x\| ≤ 14, the goal mouth must subtend ≥ 14° | No |
| Outside the box | 40% | Distance 18–25 m, angle from centre line ≤ 40°, position outside the box | Yes |
| Long range | 25% | Distance 25–35 m, angle ≤ 30° | Yes |

Pitch geometry: penalty box 16.5 m deep × 40.32 m wide. Goal 7.32 × 2.44 m (inside edges). Posts and bar 0.12 m diameter. Net depth 2.0 m.

### 2.1 Wall (outside-box and long-range spots only)
- **Size:** the keeper chooses 0 to max players. Max is 4 at ≤ 25 m, 3 at 25–30 m and 2 beyond 30 m. The default is max.
  - This is a deliberate trade-off. In the keeper's view, wall players can block the ball from sight at the strike, so a bigger wall covers more goal but hides the shot longer.
- **Position:** wall players stand on an arc 9.15 m from the ball. The default centre sits on the line from the ball to the near post. The keeper drags the wall along the arc, up to ±3.0 m from the default.
- **Spacing:** 0.5 m per player, shoulder to shoulder.
- **Jump:** the wall always jumps automatically (no player input). Take-off is 0.10 s after ball contact, the peak is +0.45 m at 0.35 s, and it lands at 0.60 s. Timing is fixed, so it is deterministic.
- **Shooter visibility:** the shooter sees the final wall before aiming.

### 2.2 Keeper start position
The keeper starts on the goal line, z = 0.3, centred on the bisector of the angle from the ball to the two posts. Placement is automatic; the keeper does not set it.

---

## 3. Controls

All gestures use Pointer Events with `getCoalescedEvents()` for full-rate touch samples, and `touch-action: none` on the game canvas. Distances are normalised to **screen heights (sh)**, so feel is the same across devices. Gesture zones stay 24 px clear of the left and right edges to avoid OS edge gestures.

### 3.1 Shooter flick — "draw the shot"
The swipe starts in the lower 60% of the screen, moves upward, and is released. From the touch path the client derives:

| Feature | Derived from | Maps to |
|---|---|---|
| **Aim (horizontal)** | Angle φ of the chord (start→end) from vertical, clamped to ±55° | `u = φ / 55°` ∈ [-1, 1]. u = ±1 targets 1.5 m outside each post; u = 0 targets the goal centre |
| **Aim (height)** | Chord length L, from 0.12 to 0.55 sh | Target height h = 0 m (ground) up to 3.4 m (well over the bar), linear |
| **Power** | Finger speed over the final 100 ms, in sh/s | Normalised p ∈ [0, 1] → launch speed 14 to 32 m/s, with an ease-in curve so the top end needs real effort |
| **Curve** | Max signed perpendicular deviation of the path from the chord, divided by chord length | c ∈ [-0.35, 0.35] → sidespin up to 60 rad/s |

**Building the launch** (server-side; see §6.2):
1. The target point T = (aim x, h) on the goal plane, corrected for the spot's angle.
2. The server solves numerically (a few free-flight passes of the sim's own integrator) for the yaw and elevation that put a ball struck at the reference speed (`v_ref` = 27 m/s), with the swipe's curl, exactly on T. A swipe that bows right therefore launches out to the right and curls back left onto T, so the path draws the shot. `curlCompensation` (default 1) scales how much of the curl the aim absorbs.
3. The actual speed comes from p, so overhitting makes the ball arrive high (it drops less), and underhitting makes it dip short or into the wall. Off-reference power also changes how much the curl bends, so curve is only "free" at the reference power.
4. For p > 0.85, extra lift is added: `+ (p − 0.85) · k_overhit` degrees. This produces the "wild, high and right" sky-ball.

**Invalid swipe** (ignored, no penalty, the player may retry within the shot clock): chord shorter than 0.08 sh, duration over 600 ms, or a net downward direction.

No trajectory preview. No random error: the outcome is purely skill.

### 3.2 Keeper flick
In the keeper view (§5.2), the swipe starts anywhere in the lower 70% of the screen. **One flick per kick; it cannot be changed.**

| Gesture | Result |
|---|---|
| **Tap** (length < 0.04 sh, < 200 ms) | **Set:** the keeper stays big in the middle. Reach is ±1.0 m lateral and 2.5 m high. Best chance to catch central shots |
| **Swipe** | **Dive/jump.** Direction angle α from horizontal sets the height. Horizontal (0–20°) is a low dive with hands at 0.3 m. Diagonal is mid to high. Steep (70–90°) is a vertical jump (lateral distance shrinks toward 0, hands reach up to 2.9 m). A downward swipe is treated as a low dive |
| Swipe length 0.04–0.35 sh | Lateral hand reach 0.6 to 3.3 m, linear (dives at full height reach 15% less far) |
| No input | Basic stance (±0.8 m lateral, 2.3 m high) |

The left/right of the swipe is the keeper's left/right, because the camera looks over the keeper's shoulder (no mirroring).

**Dive kinematics** (deterministic, piecewise polynomial; no trig):
- Windup 0.08 s after the flick.
- Travel time to full extension: `T = 0.45 + 0.15·d + 0.15·max(0, h − 1)` s (d = lateral pelvis travel in m, h = hand height). A full low dive takes about 0.85 s from the flick.
- **Auto-timing:** an early flick is held so the dive peaks no sooner than the ball arrives (the keeper "times" the dive). Flicking early therefore only risks guessing the wrong side; it never makes the keeper land before the ball gets there. Late flicks still arrive late.
- Hold at full extension for 0.25 s, then fall to the ground.
- At full stretch, hand centres reach 3.30 m from the keeper's start x. With hand radius 0.10 and ball radius 0.11, a low corner is just reachable with a well-timed dive. A perfect top-corner shot from 25 m is out of reach (tunable with `highReachScale`).

**Reaction window:** the keeper may flick at any time from the start of the shooter's run-up until the ball resolves.
- Flicking during the run-up is a pure guess (nothing about the shot is shown yet; see §6.3).
- Waiting lets the keeper see the flight but leaves less time to reach the ball.
- Design targets (asserted by `tuningReport` in `shared/src/targets.ts`): a low-corner shot from 25 m (≈ 1.1 s flight) is saveable by a flick up to ~0.39 s after contact. Penalties (≈ 0.45 s flight) need anticipation: a flick at contact is too late, while 0.25 s early (right side) saves, as in real football.

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
| Property | Starting value (tune in M0) |
|---|---|
| Mass / radius | 0.43 kg / 0.11 m |
| Gravity | 9.81 m/s² |
| Drag | `a = −k_d·|v|·v`, k_d = 0.010 /m (Cd ≈ 0.19) |
| Magnus | `a = k_m·(ω × v)`, k_m = 0.0042 (≈ 3.1 m of lateral bend over 25 m at max spin) |
| Spin decay | Time constant ≈ 4 s |
| Ground bounce | Normal restitution 0.55, tangential retention 0.7 |
| Rolling deceleration | 0.5 m/s² |

### 4.3 Collisions
Swept sphere tests against capsules and cylinders run every tick (the ball moves up to 0.13 m per tick).

- **Posts and crossbar:** cylinders of radius 0.06 m. The response reflects the normal component with restitution 0.65, keeps 0.9 of the tangential component, and halves the spin. The contact normal depends on where the ball strikes, so a glancing hit on the inside of the post deflects in, and a square hit bounces out.
- **Wall players:** a capsule of radius 0.22 m, height 1.85 m (plus the jump offset). Restitution 0.4. The ball continues afterward, so deflected goals are possible.
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

### 5.1 Shooter view
- Camera behind the ball, 1.6 m up, looking at the goal centre.
- Distance and field of view auto-fit per spot so the goal mouth fills about 70% of the screen width in portrait, with the wall and keeper fully visible.
- The swipe zone is the lower half of the screen; the goal is in the upper third.

### 5.2 Keeper view
- Camera 2.2 m behind the goal line, inside the net, 1.8 m up, over the keeper's shoulder, looking at the ball.
- The net mesh is rendered semi-transparent in front of the camera for atmosphere.
- Field of view fits both posts at the screen edges.
- Wall players occlude the ball naturally (see the wall trade-off in §2.1).

### 5.3 Sequence per kick
1. **Spot reveal** (2 s): an aerial fly-in showing the spot and category ("PENALTY", "EDGE OF THE BOX", "LONG RANGE").
2. **Wall setup** (keeper only; the shooter sees "Keeper setting the wall…").
3. **Aim:** the shooter sees the shot clock ring. The keeper sees the shooter standing over the ball ("Shooter lining up…"); none of the shooter's input is shown.
4. **Run-up** (1.2 s, a generic animation that is **identical for every kick**, so nothing is revealed early).
5. **Contact and flight**, with the keeper's reaction window.
6. **Result:** goal shows the net ripple, a flash and a "GOAL" banner; save shows the keeper celebration; miss/blocked shows the caption.
7. **Replay:** side broadcast camera. Slow motion at 0.5× around close calls (post hit, weak touch, a margin under 0.3 m).
8. **Role swap** with a short transition: "YOUR TURN TO SHOOT" / "GET IN GOAL".

### 5.4 HUD
- Two rows of 5 kick dots (plus sudden-death dots): goal ● green, non-goal ✕ red, pending ○. Each also shows a text or shape so meaning does not rely on colour alone.
- Nicknames, a role badge, a timer ring, and a round label.
- Safe-area insets (`env(safe-area-inset-*)`) are respected for the Dynamic Island and home indicator.

---

## 6. Multiplayer (real-time)

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
| Penalty guess (pre-contact dive) | 30% | 50% | 60% |
| Shooter aim error (σ) | 1.0 m | 0.65 m | 0.4 m |
| Shooter power error (σ) | 0.12 | 0.08 | 0.05 |

- **Shooter AI:** picks a target (biased toward corners and away from the wall). It converts the target to swipe features with an inverse lookup table generated offline from the sim, then adds noise.
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

### 8.1 Stack
- **TypeScript + Vite + Three.js** (WebGL2).
- Models are glTF/GLB, compressed with meshopt or Draco. Textures are KTX2 (Basis Universal).
- Monorepo: `/client`, `/server`, `/shared` (sim, protocol types, constants).

### 8.2 Look
"Grounded but gamey": a bright broadcast-style stadium at dusk or night under floodlights.
- Physically-based materials, one directional light plus an environment map (HDRI) for image-based lighting.
- Real-time shadows only for the ball, players and keeper (one 1024 shadow map); baked lighting for the stadium.
- Pitch with mowing stripes done in a shader, and painted lines.
- Crowd as instanced animated billboards, in two tiers, with simple bobbing and a celebration state.
- Goal net as a mesh with a vertex-shader ripple driven by the ball's impact point.
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

The Web Audio API mixes everything. Audio unlocks on the first tap. Set `navigator.audioSession.type = 'ambient'` where supported, so the game mixes with the user's music and respects the silent switch. No commentary.

| Sound | Trigger | Variation |
|---|---|---|
| Crowd ambience loop | Always during a match | Rises during the run-up, hushes at contact |
| Whistle | Start of each kick | — |
| Kick thump | Ball contact | Pitch and volume scaled by power; 3 samples |
| Ball whoosh | Flight | Volume follows ball speed; panned in 3D |
| Post / crossbar clang | Woodwork hit | Pitch and volume by impact speed; 3 samples |
| Glove save slap | Parry or weak touch | Strength by contact type |
| Catch thud | Catch | — |
| Wall thud | Wall block | — |
| **Net swish** | Goal (ball enters the net) | — |
| Crowd reactions | Result | Goal roar, save applause, near-miss "ohh", miss groan |
| UI | Taps, countdown ticks, match win/lose stings | — |

Settings: master volume, crowd volume, effects volume.

---

## 10. Web app shell (PWA)

- Web app manifest: `display: standalone`, `orientation: portrait`, a theme colour and icons. Include `apple-touch-icon` and the `apple-mobile-web-app-*` meta tags.
- The service worker precaches the app shell and assets. Practice and the tutorial work offline; multiplayer requires a connection.
- **Install prompt:** iOS has no automatic install prompt, so detect `navigator.standalone === false` and show a one-time sheet explaining *Share → Add to Home Screen*. It can be dismissed, and the game remains fully playable in a Safari tab.
- Prevent pinch-zoom, double-tap zoom, rubber-band scrolling and text selection on the game surface.
- **Known iOS web limits (accepted for v1):** no haptics (no vibration on iOS), no push notifications needed (real-time only), no fullscreen in a Safari tab (solved by the home-screen app).

### 10.1 Screens
1. Splash / loading
2. First run: nickname, then the tutorial
3. Main menu: **Quick Match**, **Play a Friend**, **Practice**, **Tutorial**, **Settings**, **Credits**
4. Matchmaking (spinner, cancel, AI fallback after 15 s)
5. Friend room (code, share button, waiting state)
6. Match (§5)
7. Match end (winner, kick-by-kick summary, Rematch, Menu)
8. Settings (volume, reduce camera shake, reset tutorial)

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
4. **Spot weights:** penalty 15% / inside box 20% / outside box 40% / long range 25%.
5. **Inside-the-box spots have no wall** (your answer specified walls only for outside the box).
6. **Kick power also adds lift** when overhit (p > 0.85), to produce the sky-high miss.
