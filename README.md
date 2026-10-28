# Free Kick Duel

Real-time 1v1 free kick game for mobile web. Design: [SPEC.md](SPEC.md).

## Layout

- `shared/`: the deterministic kick sim used by server and clients (ball physics, posts and bar, wall, keeper hitbox, outcomes), input mapping, and tuning targets.
- `harness/`: M0 desktop tuning harness (Vite + Three.js).

## Commands

```bash
npm install
npm test              # sim unit tests, tuning targets, golden determinism check
npm run harness       # tuning harness at http://localhost:5174
npm run harness:lan   # same, reachable from a phone on your Wi-Fi
npm run golden        # regenerate shared/golden/determinism.json after changing DEFAULT_PARAMS
npm run typecheck
```

## Harness

- **Shooter pad:** draw a flick upward. Its direction is aim, length is height, finger speed at release is power, and the bend of the path is curl.
- **Keeper pad:** flick as seen from behind the keeper (screen-right = keeper's right). A tap means stay set.
- **Live keeper:** plays the run-up and flight in real time; flick the keeper pad to react, and the reaction time is recorded.
- **Save heatmap:** for every aim point, would a perfect keeper reacting at the chosen delay save it?
- **Constants:** every `SimParams` value, live. The tuning-target list in the results panel re-checks as you drag. Use "Copy changed constants" to paste tuned values back into `shared/src/params.ts`.
- **Determinism page** (`/determinism.html`): open it on an iPhone (via `harness:lan`) to confirm Safari's JS engine reproduces Node's sim hashes exactly.
