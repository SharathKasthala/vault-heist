import { formatTime } from './utils.js';

// Tune the game here.
// hearingRange: how far from the code (in numbers) the beeps and glow start reacting.
// buzzRange: how close you must be before the phone vibrates.
export const DIFFICULTIES = {
  easy: { label: 'Easy', timeLimit: 120, attempts: 4, warning: 20, hearingRange: 50, buzzRange: 3 },
  normal: { label: 'Normal', timeLimit: 90, attempts: 3, warning: 15, hearingRange: 40, buzzRange: 2 },
  hard: { label: 'Hard', timeLimit: 60, attempts: 2, warning: 10, hearingRange: 22, buzzRange: 1 },
};

export const DEFAULT_DIFFICULTY = 'normal';

export function getDifficulty(key) {
  return DIFFICULTIES[key] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

export function describeDifficulty(config) {
  return `${formatTime(config.timeLimit)} on the clock, ${config.attempts} tries per lock`;
}

// 3 stars: no wrong guesses and at least half the clock left.
// 2 stars: two or fewer wrong guesses and at least a quarter of the clock left.
// 1 star: you opened the vault.
export function getStars(config, timeLeft, wrongGuesses) {
  const share = timeLeft / config.timeLimit;
  if (wrongGuesses === 0 && share >= 0.5) return 3;
  if (wrongGuesses <= 2 && share >= 0.25) return 2;
  return 1;
}

export function getNextStarTip(stars) {
  if (stars >= 3) return 'Perfect crack. No wrong guesses and time to spare.';
  if (stars === 2) return 'For 3 stars: no wrong guesses with half the clock left.';
  return 'For 2 stars: two or fewer wrong guesses with a quarter of the clock left.';
}
