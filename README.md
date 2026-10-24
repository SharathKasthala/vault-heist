![Vault Heist](public/logo.png)

# Vault Heist

A safe-cracking puzzle game built with React and Vite. Spin the dial, listen to the lock, and open all three locks before the clock runs out.

**Play it:** _add your Vercel link here_

## How to play
1. Pick a difficulty and tap **Unlock Safe**.
2. Drag the dial (or use the buttons) and listen. The beeps get higher and faster as you get close to the code.
3. Press **Confirm** when you think you've found it. Crack all three locks to open the vault.

The clock starts on your first turn. Use up your tries on one lock, or run out of time, and the vault seals.

| Level  | Clock | Tries per lock | Clues |
|--------|-------|----------------|-------|
| Easy   | 2:00  | 4 | Beeps and glow react from far away |
| Normal | 1:30  | 3 | Standard range |
| Hard   | 1:00  | 2 | Clues only kick in close to the code |

## Stars
- ⭐⭐⭐ No wrong guesses and at least half the clock left
- ⭐⭐ Two or fewer wrong guesses and at least a quarter of the clock left
- ⭐ You opened the vault

Your best time and star rating are saved for each difficulty.

## Features
- Drag-to-turn dial that works with mouse and touch
- Sound clues, plus optional visual hints (the dial glows from cold blue to red-hot)
- Vibration feedback on Android phones
- Countdown timer with a warning when time is low
- Unlock sequence with a spinning dial, gold flash, confetti and fanfare
- Keyboard play and screen-reader labels; animations respect reduced-motion settings

## Controls
| Action | Mouse / touch | Keyboard |
|--------|---------------|----------|
| Turn the dial | Drag the dial, or Left / Right | ← → or A / D |
| Confirm a code | Confirm | Enter |
| Sound on/off | 🔊 | M |
| Visual hints | 💡 | H |
| Vibration | 📳 (Android only) | V |
| Back | Back to safe | Esc |

## Run it locally
```
npm install
npm run dev
```

To test on your phone, run `npm run dev -- --host` and open the network address it prints (phone and computer on the same Wi-Fi).

## Build and deploy
```
npm run build
```
The site builds into `dist/`. On Vercel or Netlify, import the repo and keep the defaults (build command `npm run build`, output folder `dist`).

## Tuning
- Difficulty levels and star rules: `src/difficulty.js`
- Sound, animation timing and vibration patterns: top of `src/components/SafeMechanism.jsx`

## Project structure
```
src/
  App.jsx                    Home screen and difficulty picker
  difficulty.js              Difficulty levels and star rules
  utils.js                   Time formatting and saved settings
  components/
    SafeMechanism.jsx        The dial, locks, timer and win/lose screens
    Confetti.jsx             Win-screen confetti
    StarRating.jsx           Star display
  assets/images/             Safe images
public/                      Icons and logo
```
