# Know Your Roch

Guess what they would say. Prove you know your people.

A Jackbox-style party game for 2–10 players. One phone each, no accounts. The host can play too, and a laptop or TV can show the room. The hot seat answers in secret. Everyone else tries to predict them. Correct guesses score, streaks pay extra, and the podium hands out a **Knows You Best** award for every player.

The name lives in one place: `GAME_NAME` in `lib/config.js`.

## How to play

1. The host opens the site, taps **Host a room**, and picks a nickname. They get a 4-letter code and they are playing, not just running the screen.
2. Everyone else opens the site on their phone, taps **Join with a code**, and enters the code plus a nickname.
3. Optional: on the TV or a laptop, open **Big screen** (or `/tv/CODE`). That view shows the code, the question, and the reveal. It never shows secret answers early.
4. The host picks categories and how many rounds each player sits in the hot seat (1–5), then starts. You need at least 2 players and at most 10.
5. Each round, one player is in the **hot seat**. A question about them appears. They answer privately. Everyone else locks in a prediction.
6. The reveal holds the answer for a beat, then shows who got it. Exact matches score on multiple choice, this-or-that, and "who in this room." On number questions, the closest guess wins, and ties share it. On free-text, the hot seat taps which guesses count as right.
7. A correct guess builds a streak. The second in a row adds +50, then +100, up to +200. A miss resets it. The hot seat's own turn does not break their streak.
8. The hot seat rotates in seat order so everyone gets the same number of turns. After the last round: a podium, confetti, and a **Knows You Best** award for each player (who predicted them most often).
9. Refresh the page and the same nickname takes the same seat. The emoji bar is a shared soundboard. The speaker button mutes it on your device only.

Players can write their own questions in the lobby, or while they are waiting during a round. Those show up as **question by &lt;name&gt;**.

### Question mix

324 original questions across nine categories:

- Favorites
- Food
- Childhood
- Would They Rather
- Habits & Quirks
- Faith & Family
- Embarrassing (family-friendly)
- Dreams & Future
- Who's Most Likely

Types are multiple choice, this-or-that, number (including "how many hours of sleep"), who in this room, and short free text.

## Add it to your home screen

The site is a PWA: a web manifest, icons, a service worker for the shell, `standalone` display, and a theme color. After the first load it can open like an app.

- **iPhone:** Safari → Share → Add to Home Screen.
- **Android:** Chrome menu → Install app, or Add to Home screen. The home screen also offers the install button when the browser allows it.

## Run it

```bash
npm install
npm start
```

Node 20+. Open `http://localhost:4877`.

`PORT` sets the listen port. `TIME_SCALE` speeds every timer (the tests use the real server without needing this). `GRACE_MS` is how long a dropped phone keeps its seat (default 15 seconds).

## Tests

```bash
npm test
```

The suite covers scoring, closest-number ties, streak bonuses, hot-seat rotation, free-text judging, hidden answers before the reveal, the 10-player cap, nickname reconnect, custom questions, the question bank (300+), and a socket round from create through a scored reveal.

## Deploy (Render)

`render.yaml` is included. Create a free **Web Service** from this repo with build `npm install`, start `npm start`, health check `/healthz`, and env `NODE_VERSION=20`. Render sets `PORT`.

## Soundboard

The emoji bar uses short CC0 recordings (plop, squeak, whoop, boo, cheer, laugh, fire, bone crack, clap, gasp), decoded in the Web Audio API after the first tap so mobile Safari will play them. Sources and licenses are in `public/sounds/README.md`. The 🎉 sparkle, the lock-in chime, the drumroll, and the podium sting are synthesized in the browser. Mute is per device.

## Credits

All names, questions, and the bird mascot are original to this game. It is not affiliated with any card game. The reaction recordings are CC0; see `public/sounds/README.md`.
