# Flick Arena

Real-time 1v1 flick-to-kick game for mobile web: free kicks and field goals. Design: [SPEC.md](SPEC.md).

## Layout

- `shared/`: the deterministic kick sim used by server and clients (ball physics, posts and bar, wall, keeper hitbox, outcomes), input mapping, match rules, AI opponent, and tuning targets.
- `client/`: the game (Vite + Three.js, portrait mobile web): menus, play vs AI, practice, play a friend.
- `server/`: the game server (Node + `ws`): serves the built game and runs friend matches over a WebSocket at `/ws`.
- `harness/`: M0 desktop tuning harness (Vite + Three.js).

## Commands

```bash
npm install
npm run dev           # the game at http://localhost:5175
npm run dev:lan       # same, reachable from a phone on your Wi-Fi
npm run server        # the game server on :8787 (friend matches; run it alongside dev, which passes /ws through to it)
npm test              # sim unit tests, tuning targets, match rules, AI, golden determinism check, the server's match flow
npm run harness       # tuning harness at http://localhost:5174
npm run harness:lan   # same, reachable from a phone on your Wi-Fi
npm run golden        # regenerate shared/golden/determinism.json after changing DEFAULT_PARAMS
npm run typecheck
npm run build         # production build in client/dist
npm run server:build  # bundle the server into server/dist
npm start             # the server: the built game and friend matches on one port (PORT, default 8787)
npm run preview       # serve the client build alone on your Wi-Fi at port 5176 (the offline service worker only runs in builds)
```

### Deploying (so friends can play from anywhere)

The server is one Node process that serves the game and runs the matches on a single port, so it deploys anywhere that runs Node 20 and allows WebSockets. Rooms live in memory, so run a single instance.

- **Render** (free tier): push this repo to GitHub, then in Render choose New → Blueprint and pick the repo; `render.yaml` sets it up (build, start, health check at `/health`). Free instances sleep after 15 minutes idle and take a minute to wake on the next visit.
- **Fly.io, Railway or any container host:** use the `Dockerfile` (it listens on `PORT`, 8080 in the image).
- **Your own machine:** `npm run build && npm run server:build && npm start`, then open `http://<your-ip>:8787` on phones on the same Wi-Fi.

Serve it over HTTPS in production (the hosts above do it for you). On iPhone, open it in Safari and use Share → Add to Home Screen for the full-screen app.

### Playing

- **Shoot:** swipe up to where you want the ball to go and lift your finger there: on the top corner, the bar, low by the post. The ball sets off the way your swipe starts, so bending the swipe bends the ball (start it outside the wall and finish at the far post). How fast your flick gets is the power, so you can flick hard and still stop on a low corner (a slow, deliberate swipe is a soft side-foot; finish low and it skims along the grass); snap it really hard and it rises over. Bend it right and it's a trivela off the outside of the boot. Swipe up and snap straight back down to chip (a curve that rolls over and comes down is still a curl): the top of the swipe is the aim; from the spot, down the middle, that's a Panenka. Every strike has a little error, more when you hit it hard or bend it, so aiming right into the corner is a risk. The read-out after each kick shows speed, power and curl.
- **Field goals:** the second mode (Play vs AI or Practice → Game: Field goals), in an American football stadium. Swipe over the bar between the uprights; your swipe calls for the snap and the kick follows 1.25 s later. Lift it over the hands at the line, aim (or bend it) into the wind, and from round 2 mind the cable cam swinging over the field: it will have moved by the time the ball gets there. Kicks come from wide (high school) hashes, further out and windier each round (the arrow and the ribbons on the posts show the wind). Make more than the AI in 5 kicks each.
- **Wind in free kicks too:** each round has its own wind, stronger in later rounds; it carries the ball, so aim off. The arrow and the corner flags show it.
- **Coin toss:** a match starts at midfield with the captains, the kickers and the referee: call heads or tails, and the winner chooses to kick or keep (defend) first.
- **Sudden death:** level after five, the game stops for it, and from then on the clock is shorter, the screen's edges pulse and the crowd hushes for every kick. Any kick that can win or lose the match is called out on screen.
- **Picture:** a deliberate PS2-era look: a low-res 16-bit framebuffer (dither, bloom, floodlight flares and shadows) shown through a CRT (scanline beams, soft composite colour, an aperture grille). Settings → Picture → *Clean* turns the filter off.
- **Keep:** set the wall (drag to slide it, −/+ for players), then flick from the keeper toward the spot you want to reach, any time from the run-up on (a ring shows where the hands will go while you drag; flick across the goal's width to reach a post, diagonally for a top corner, straight up to jump), or tap to stay big.
- **Sound:** recorded crowd, whistle, kicks, saves, woodwork, bounces and net (credits in `client/public/sfx/CREDITS.txt` and Settings), each ground with its own live crowd and its own cheer (real soccer and NFL stadium recordings, levelled and crossfaded so the crowd never loops the same way twice). The crowd is yours: it cheers every goal (yours loudest), goes quiet at your misses, and enjoys the AI's. Toggle with 🔊 in game or in Settings.
- **Taunts:** while the AI lines up, get in its head, and spam them: as the keeper (△ jelly legs, ○ bar slap, □ star man) or as the right-hand gunner on a field goal (△ hype, ○ airplane, □ war dance). The AI sometimes has a go back.
- **Play a friend:** Play a friend → your name and the game → *Create a room*, then *Send the invite* (the share sheet, or the link copied) or read them the 6-letter code; they open the link (or type the code and tap *Join*) and the match starts: the coin toss (they call it, the winner chooses), then the same match as against the AI, with them keeping when you shoot and taunting you while you line up. Both phones see the same kicks: the server runs every one. If someone's connection drops, the match waits 20 seconds for them (the kick in play starts over when they're back); after that, or if they leave, the other wins. Rematch from the end screen.
- **Camera:** two fingers to orbit and pinch to zoom (right-drag and the wheel on desktop). Your view is remembered separately for shooting and keeping; ⟲ resets it, and Settings → Reset camera views resets them all.

Dev shortcuts: append `#practice-shoot`, `#practice-keep`, `#match`, `#fieldgoals` or `#practice-fieldgoals` to the URL to skip the menu; add a spot category to practice, e.g. `#practice-shoot/long_range` (`penalty`, `outside_box`, `long_range`, `any`). `#lab-keeper` loops the keeper's dives, and `?case=N&t=S#lab-keeper` freezes dive N at S seconds.

## Harness

- **Shooter pad:** draw a flick upward. The pad has no goal to aim at, so its chord's lean is across the goal and its length is height; its start is the start line and average finger speed is power; the curl slider then shows the spin the solver needed for that bend.
- **Keeper pad:** flick as seen from behind the keeper (screen-right = keeper's right). A tap means stay set.
- **Live keeper:** plays the run-up and flight in real time; flick the keeper pad to react, and the reaction time is recorded.
- **Save heatmap:** for every aim point, would a perfect keeper reacting at the chosen delay save it?
- **Constants:** every `SimParams` value, live. The tuning-target list in the results panel re-checks as you drag. Use "Copy changed constants" to paste tuned values back into `shared/src/params.ts`.
- **Determinism page** (`/determinism.html`): open it on an iPhone (via `harness:lan`) to confirm Safari's JS engine reproduces Node's sim hashes exactly.
