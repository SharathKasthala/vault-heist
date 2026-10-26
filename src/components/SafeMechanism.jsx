import { useCallback, useEffect, useRef, useState } from 'react';
import unlockedSafeImage from '../assets/images/unlocked-safe.webp';
import applauseSoundUrl from '../assets/sounds/applause.mp3';
import popSoundUrl from '../assets/sounds/confetti.mp3';
import Confetti from './Confetti.jsx';
import StarRating from './StarRating.jsx';
import { formatTime, readStorage, writeStorage } from '../utils.js';
import { getDifficulty, getNextStarTip, getStars } from '../difficulty.js';
import './SafeMechanism.css';

const TOTAL_NUMBERS = 100;
const LOCK_COUNT = 3;
const IDLE_SOUND_MS = 5000; // beeping pauses after this long without turning
const UNLOCK_SEQUENCE_MS = 1800; // length of the final unlock animation
const STAR_START_MS = 1150; // when the first star pops on the win screen
const STAR_STEP_MS = 250; // gap between stars

// Win-screen sound timing (ms after the open safe appears).
const POP_AT_MS = 300; // matches the confetti cannons
const FANFARE_AT_MS = 450;
const APPLAUSE_AT_MS = 650;

// Applause grows with the star rating: volume (0-1) and how long it plays (s).
const APPLAUSE_BY_STARS = {
  1: { volume: 0.3, length: 2.2 },
  2: { volume: 0.45, length: 3.2 },
  3: { volume: 0.6, length: 4.1 },
};

const SOUND_FILES = {
  applause: applauseSoundUrl,
  pop: popSoundUrl,
};

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}
const DEGREES_PER_NUMBER = 360 / TOTAL_NUMBERS;
const DIAL_MARKS = Array.from({ length: TOTAL_NUMBERS }, (_, number) => number);

const MUTED_KEY = 'vault-muted';
const HINTS_KEY = 'vault-hints';
const VIBRATION_KEY = 'vault-vibration';

const CAN_VIBRATE = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const HAPTICS = {
  near: 12,
  onCode: 30,
  wrong: [120],
  lockOpen: [40, 60, 40],
  unlock: [80, 60, 80, 60, 220],
  gameOver: [300],
  star: 25,
};

const HEAT_LEVELS = [
  { maxDistance: 2, label: 'Burning hot' },
  { maxDistance: 6, label: 'Hot' },
  { maxDistance: 15, label: 'Warm' },
  { maxDistance: 30, label: 'Cool' },
  { maxDistance: Infinity, label: 'Cold' },
];

function createSecretCodes() {
  const codes = new Set();
  while (codes.size < LOCK_COUNT) {
    codes.add(Math.floor(Math.random() * TOTAL_NUMBERS));
  }
  return Array.from(codes);
}

function formatNumber(number) {
  return String(number).padStart(2, '0');
}

// The dial's rotation is an unbounded step count, so the CSS transition never
// spins the long way round when passing 99 -> 00. This maps it back to 0-99.
function wrapNumber(rotation) {
  return ((rotation % TOTAL_NUMBERS) + TOTAL_NUMBERS) % TOTAL_NUMBERS;
}

// Returns the closest rotation that shows 00, so resets take the short path.
function nearestZero(rotation) {
  const number = wrapNumber(rotation);
  return number <= TOTAL_NUMBERS / 2 ? rotation - number : rotation + (TOTAL_NUMBERS - number);
}

function getCircularDistance(number, target) {
  const difference = Math.abs(number - target);
  return Math.min(difference, TOTAL_NUMBERS - difference);
}

// 0 (out of range) to 1 (on the code). Harder levels have a shorter range.
function getCloseness(number, target, range) {
  return Math.max(0, 1 - getCircularDistance(number, target) / range);
}

// Visual version of the beeps: a closeness value, colour and label.
function getHeat(number, target, range) {
  const distance = getCircularDistance(number, target);
  const heat = getCloseness(number, target, range);
  const levelIndex = HEAT_LEVELS.findIndex((level) => distance <= level.maxDistance);
  const hue = Math.round(205 - heat * 180); // icy blue -> red-orange

  return {
    heat,
    color: `hsl(${hue} 90% 58%)`,
    label: HEAT_LEVELS[levelIndex].label,
    bars: HEAT_LEVELS.length - levelIndex,
  };
}

// Plays one short tone and returns its oscillator.
function scheduleTone(context, { frequency, endFrequency, start = 0, duration, type = 'sine', volume = 0.2 }) {
  const startAt = context.currentTime + start;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
  }

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
  return oscillator;
}

export default function SafeMechanism({ difficulty, onBack, onWin, bestRecord = null }) {
  const config = getDifficulty(difficulty);
  const startMessage = `Turn the dial to start the clock. You have ${formatTime(config.timeLimit)} to open all ${LOCK_COUNT} locks.`;

  const [rotation, setRotation] = useState(0);
  const [secretCodes, setSecretCodes] = useState(createSecretCodes);
  const [currentLock, setCurrentLock] = useState(0);
  const [attemptsUsed, setAttemptsUsed] = useState(() => Array(LOCK_COUNT).fill(0));
  const [unlockedLocks, setUnlockedLocks] = useState(() => Array(LOCK_COUNT).fill(false));
  const [feedback, setFeedback] = useState(startMessage);
  const [isChecking, setIsChecking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [lossReason, setLossReason] = useState(null); // 'attempts' | 'time'
  const [showOpenedSafe, setShowOpenedSafe] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [winStars, setWinStars] = useState(0);
  const [pulseRing, setPulseRing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(config.timeLimit);
  const [timerRunning, setTimerRunning] = useState(false);
  const [muted, setMuted] = useState(() => readStorage(MUTED_KEY, false));
  const [hintsOn, setHintsOn] = useState(() => readStorage(HINTS_KEY, false));
  const [vibrationOn, setVibrationOn] = useState(() => CAN_VIBRATE && readStorage(VIBRATION_KEY, true));

  const rotationRef = useRef(0);
  const confirmedRef = useRef(false);
  const mutedRef = useRef(muted);
  const vibrationRef = useRef(vibrationOn);
  const lastTurnRef = useRef(0);
  const lastPulseRef = useRef(0);
  const proximityActive = useRef(false);
  const audioContext = useRef(null);
  const proximityTimer = useRef(null);
  const proximityToken = useRef(0);
  const proximityOscillators = useRef(new Set());
  const transitionTimer = useRef(null);
  const deadlineRef = useRef(null);
  const keyHandlerRef = useRef(null);
  const housingRef = useRef(null);
  const dragRef = useRef(null);
  const soundFiles = useRef({}); // name -> Promise of the raw file
  const soundBuffers = useRef({}); // name -> decoded audio, ready to play
  const celebrationSources = useRef(new Set());

  const isPlaying = !gameOver && !showOpenedSafe;
  const currentNumber = wrapNumber(rotation);

  /* ---------- Haptics ---------- */

  // Vibration works on most Android browsers; iPhones ignore it.
  const buzz = useCallback((pattern) => {
    if (!CAN_VIBRATE || !vibrationRef.current) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers block vibration until the user interacts.
    }
  }, []);

  /* ---------- Audio ---------- */

  const getAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContext.current) {
      audioContext.current = new AudioContextClass();
    }
    if (audioContext.current.state === 'suspended') {
      await audioContext.current.resume();
    }
    return audioContext.current;
  }, []);

  // Runs a sound recipe unless the game is muted.
  const playSound = useCallback(async (recipe) => {
    if (mutedRef.current) return;
    try {
      const context = await getAudioContext();
      if (context && !mutedRef.current) recipe(context);
    } catch (error) {
      console.error('Unable to play sound:', error);
    }
  }, [getAudioContext]);

  const stopProximitySound = useCallback(() => {
    // Bumping the token cancels any pulse loop that is mid-await.
    proximityToken.current += 1;
    proximityActive.current = false;

    if (proximityTimer.current !== null) {
      clearTimeout(proximityTimer.current);
      proximityTimer.current = null;
    }

    proximityOscillators.current.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have stopped.
      }
    });
    proximityOscillators.current.clear();
  }, []);

  const startProximitySound = useCallback((target) => {
    stopProximitySound();
    if (mutedRef.current) return;

    const token = proximityToken.current;
    proximityActive.current = true;

    const playPulse = async () => {
      if (token !== proximityToken.current) return;

      // Go quiet when the player stops turning; the next turn restarts it.
      if (Date.now() - lastTurnRef.current > IDLE_SOUND_MS) {
        proximityActive.current = false;
        return;
      }

      const closeness = getCloseness(wrapNumber(rotationRef.current), target, config.hearingRange);
      lastPulseRef.current = Date.now();

      await playSound((context) => {
        const oscillator = scheduleTone(context, {
          frequency: 180 + closeness * 820,
          duration: 0.045 + closeness * 0.09,
          volume: 0.12,
        });
        proximityOscillators.current.add(oscillator);
        oscillator.addEventListener('ended', () => proximityOscillators.current.delete(oscillator));
      });

      if (token !== proximityToken.current) return;
      proximityTimer.current = setTimeout(playPulse, 800 - closeness * 650);
    };

    playPulse();
  }, [config.hearingRange, playSound, stopProximitySound]);

  // Restart the pulse for instant feedback, but not on every step of a fast
  // drag, which would turn into a buzzsaw.
  const nudgeProximitySound = useCallback((target) => {
    if (proximityActive.current && Date.now() - lastPulseRef.current < 120) return;
    startProximitySound(target);
  }, [startProximitySound]);

  const playConfirmationSound = useCallback((isCorrect) => {
    playSound((context) => {
      if (isCorrect) {
        scheduleTone(context, { frequency: 880, duration: 0.12, volume: 0.3 });
        scheduleTone(context, { frequency: 1175, start: 0.12, duration: 0.2, volume: 0.3 });
      } else {
        scheduleTone(context, { frequency: 180, duration: 0.25, type: 'square', volume: 0.2 });
      }
    });
  }, [playSound]);

  // Heavy bolts sliding back, then a final clank as the door releases.
  const playBoltSound = useCallback(() => {
    playSound((context) => {
      [0, 0.22, 0.44].forEach((start) => {
        scheduleTone(context, { frequency: 140, endFrequency: 55, start, duration: 0.16, type: 'square', volume: 0.22 });
      });
      scheduleTone(context, { frequency: 320, endFrequency: 90, start: 0.85, duration: 0.35, type: 'sawtooth', volume: 0.18 });
      scheduleTone(context, { frequency: 1568, start: 1.3, duration: 0.5, type: 'sine', volume: 0.08 });
    });
  }, [playSound]);

  // Short rising fanfare with a shimmering chord on top.
  const playFanfare = useCallback(() => {
    playSound((context) => {
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        scheduleTone(context, { frequency, start: index * 0.12, duration: 0.2, type: 'triangle', volume: 0.25 });
      });
      scheduleTone(context, { frequency: 1046.5, start: 0.36, duration: 0.9, type: 'triangle', volume: 0.28 });
      [1318.5, 1568, 2093].forEach((frequency, index) => {
        scheduleTone(context, { frequency, start: 0.5 + index * 0.05, duration: 1.1, volume: 0.06 });
      });
    });
  }, [playSound]);

  // One rising chime per earned star.
  const playStarChime = useCallback((index) => {
    playSound((context) => {
      const frequency = [1318.5, 1568, 2093][index] ?? 2093;
      scheduleTone(context, { frequency, duration: 0.3, type: 'triangle', volume: 0.2 });
      scheduleTone(context, { frequency: frequency * 2, start: 0.03, duration: 0.25, volume: 0.05 });
    });
  }, [playSound]);

  // Decodes a sound file once, then reuses it.
  const loadSound = useCallback(async (name) => {
    if (soundBuffers.current[name]) return soundBuffers.current[name];

    const context = await getAudioContext();
    const data = await soundFiles.current[name];
    if (!context || !data) return null;

    try {
      const buffer = await context.decodeAudioData(data.slice(0));
      soundBuffers.current[name] = buffer;
      return buffer;
    } catch (error) {
      console.error(`Unable to decode ${name} sound:`, error);
      return null;
    }
  }, [getAudioContext]);

  // Plays a recorded clip. pan: -1 (left) to 1 (right).
  // stopAfter: seconds to play before fading out, for shorter versions.
  const playClip = useCallback(async (name, { volume = 1, pan = 0, stopAfter = null, fadeOut = 0.6 } = {}) => {
    if (mutedRef.current) return;

    const buffer = await loadSound(name);
    const context = audioContext.current;
    if (!buffer || !context || mutedRef.current) return;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const nodes = [gain];
    const now = context.currentTime;

    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, now);
    source.connect(gain);

    if (pan && context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(context.destination);
      nodes.push(panner);
    } else {
      gain.connect(context.destination);
    }

    celebrationSources.current.add(source);
    source.onended = () => {
      celebrationSources.current.delete(source);
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
    };

    source.start(now);

    if (stopAfter !== null && stopAfter < buffer.duration) {
      gain.gain.setValueAtTime(volume, now + Math.max(0, stopAfter - fadeOut));
      gain.gain.linearRampToValueAtTime(0.0001, now + stopAfter);
      source.stop(now + stopAfter + 0.05);
    }
  }, [loadSound]);

  const stopCelebrationSounds = useCallback(() => {
    celebrationSources.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    });
    celebrationSources.current.clear();
  }, []);

  /* ---------- Timer ---------- */

  const clearTransition = useCallback(() => {
    if (transitionTimer.current !== null) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    deadlineRef.current = null;
    setTimerRunning(false);
  }, []);

  const endGame = useCallback((reason) => {
    stopProximitySound();
    clearTransition();
    stopTimer();
    dragRef.current = null;
    confirmedRef.current = false;
    setIsDragging(false);
    setIsChecking(false);
    setPulseRing(false);
    setLossReason(reason);
    setGameOver(true);
    buzz(HAPTICS.gameOver);
  }, [buzz, clearTransition, stopProximitySound, stopTimer]);

  function startTimerIfNeeded() {
    if (deadlineRef.current !== null || timerRunning) return;
    deadlineRef.current = Date.now() + timeLeft * 1000;
    setTimerRunning(true);
  }

  useEffect(() => {
    if (!timerRunning) return undefined;

    const intervalId = setInterval(() => {
      if (deadlineRef.current === null) return;

      const remaining = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);

      if (remaining === 0) {
        endGame('time');
      }
    }, 200);

    return () => clearInterval(intervalId);
  }, [timerRunning, endGame]);

  /* ---------- Settings ---------- */

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    writeStorage(MUTED_KEY, nextMuted);

    if (nextMuted) {
      stopProximitySound();
      stopCelebrationSounds();
      // Without sound the player needs another clue, so switch hints on.
      if (!hintsOn) {
        setHintsOn(true);
        writeStorage(HINTS_KEY, true);
        setFeedback('Sound off. Visual hints are on so you can still see how close you are.');
      }
    }
  }

  function toggleHints() {
    const nextHints = !hintsOn;
    setHintsOn(nextHints);
    writeStorage(HINTS_KEY, nextHints);
  }

  function toggleVibration() {
    if (!CAN_VIBRATE) return;
    const nextVibration = !vibrationOn;
    setVibrationOn(nextVibration);
    vibrationRef.current = nextVibration;
    writeStorage(VIBRATION_KEY, nextVibration);
    if (nextVibration) buzz(HAPTICS.onCode);
  }

  /* ---------- Game actions ---------- */

  // Positive steps turn the dial clockwise (the number under the pointer goes down).
  function rotateBy(steps) {
    if (confirmedRef.current || !isPlaying || steps === 0) return;

    startTimerIfNeeded();
    lastTurnRef.current = Date.now();

    const next = rotationRef.current - steps;
    rotationRef.current = next;
    setRotation(next);
    setFeedback('');

    const target = secretCodes[currentLock];
    nudgeProximitySound(target);

    const distance = getCircularDistance(wrapNumber(next), target);
    if (distance === 0) buzz(HAPTICS.onCode);
    else if (distance <= config.buzzRange) buzz(HAPTICS.near);
  }

  function beginUnlockSequence() {
    const finalTime = deadlineRef.current === null
      ? timeLeft
      : Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
    const wrongGuesses = attemptsUsed.reduce((total, used) => total + used, 0);
    const stars = getStars(config, finalTime, wrongGuesses);

    stopTimer();
    setTimeLeft(finalTime);
    setWinStars(stars);
    setIsNewBest(bestRecord === null || finalTime > bestRecord.timeLeft);
    onWin?.({ timeLeft: finalTime, stars });

    // Two fast full turns of the dial while the bolts slide back.
    dragRef.current = null;
    setIsDragging(false);
    rotationRef.current += TOTAL_NUMBERS * 2;
    setRotation(rotationRef.current);
    setIsUnlocking(true);
    setFeedback('All locks released. Opening the vault...');
    playBoltSound();
    buzz(HAPTICS.unlock);

    // Decode the win sounds now so they're ready when the vault opens.
    loadSound('pop');
    loadSound('applause');

    transitionTimer.current = setTimeout(() => {
      setIsUnlocking(false);
      setShowOpenedSafe(true);
      setPulseRing(false);
      setIsChecking(false);
      confirmedRef.current = false;
      transitionTimer.current = null;
    }, UNLOCK_SEQUENCE_MS);
  }

  function confirmNumber() {
    if (confirmedRef.current || !isPlaying) return;

    startTimerIfNeeded();
    stopProximitySound();

    const selectedNumber = wrapNumber(rotationRef.current);
    const isCorrect = selectedNumber === secretCodes[currentLock];

    confirmedRef.current = true;
    setIsChecking(true);
    setPulseRing(isCorrect);

    if (isCorrect) {
      const isFinalLock = currentLock === LOCK_COUNT - 1;

      setUnlockedLocks((previous) =>
        previous.map((unlocked, index) => (index === currentLock ? true : unlocked))
      );

      if (isFinalLock) {
        beginUnlockSequence();
        return;
      }

      setFeedback(`Lock ${currentLock + 1} unlocked!`);
      playConfirmationSound(true);
      buzz(HAPTICS.lockOpen);

      transitionTimer.current = setTimeout(() => {
        const zero = nearestZero(rotationRef.current);
        rotationRef.current = zero;
        setRotation(zero);
        setCurrentLock((previous) => previous + 1);
        setFeedback(`Lock ${currentLock + 2}: find the next code.`);
        setPulseRing(false);
        setIsChecking(false);
        confirmedRef.current = false;
        transitionTimer.current = null;
      }, 1000);
      return;
    }

    const nextAttempts = attemptsUsed.map((used, index) =>
      index === currentLock ? used + 1 : used
    );
    const remaining = config.attempts - nextAttempts[currentLock];

    setAttemptsUsed(nextAttempts);
    playConfirmationSound(false);
    buzz(HAPTICS.wrong);

    if (remaining <= 0) {
      // Stop the clock now so it can't also run out during the short delay.
      stopTimer();
      setFeedback(`${config.attempts} incorrect attempts. The vault is locked.`);
      transitionTimer.current = setTimeout(() => endGame('attempts'), 650);
      return;
    }

    // Keep the number away from the full stop so "67. 3 attempts" can't read as 67.3.
    setFeedback(
      `${formatNumber(selectedNumber)} isn't the code. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left on this lock.`
    );
    transitionTimer.current = setTimeout(() => {
      setIsChecking(false);
      setPulseRing(false);
      confirmedRef.current = false;
      transitionTimer.current = null;
      lastTurnRef.current = Date.now();
      startProximitySound(secretCodes[currentLock]);
    }, 450);
  }

  function restartGame() {
    stopProximitySound();
    stopCelebrationSounds();
    clearTransition();
    stopTimer();

    rotationRef.current = 0;
    confirmedRef.current = false;
    dragRef.current = null;

    setSecretCodes(createSecretCodes());
    setRotation(0);
    setCurrentLock(0);
    setAttemptsUsed(Array(LOCK_COUNT).fill(0));
    setUnlockedLocks(Array(LOCK_COUNT).fill(false));
    setFeedback(`New codes set. ${startMessage}`);
    setIsChecking(false);
    setIsUnlocking(false);
    setIsDragging(false);
    setGameOver(false);
    setLossReason(null);
    setShowOpenedSafe(false);
    setIsNewBest(false);
    setWinStars(0);
    setPulseRing(false);
    setTimeLeft(config.timeLimit);
  }

  function handleBack() {
    stopProximitySound();
    stopCelebrationSounds();
    onBack?.();
  }

  /* ---------- Drag to turn ---------- */

  function getPointerAngle(event, drag) {
    return (Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180) / Math.PI;
  }

  function handlePointerDown(event) {
    if (!isPlaying || confirmedRef.current || !housingRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const rect = housingRef.current.getBoundingClientRect();
    const drag = {
      pointerId: event.pointerId,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      remainder: 0,
    };
    drag.lastAngle = getPointerAngle(event, drag);

    dragRef.current = drag;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    // Angles near the exact centre jump around, so ignore that spot.
    if (Math.hypot(event.clientX - drag.centerX, event.clientY - drag.centerY) < 14) return;

    const angle = getPointerAngle(event, drag);
    let delta = angle - drag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    drag.lastAngle = angle;

    // Clockwise on screen is a positive angle change.
    drag.remainder += delta;
    const steps = Math.trunc(drag.remainder / DEGREES_PER_NUMBER);
    if (steps !== 0) {
      drag.remainder -= steps * DEGREES_PER_NUMBER;
      rotateBy(steps);
    }
  }

  function handlePointerEnd(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  }

  /* ---------- Keyboard ---------- */

  // Keep the latest handler in a ref so the window listener is added only once.
  useEffect(() => {
    keyHandlerRef.current = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === 'escape') {
        handleBack();
        return;
      }

      if (!isPlaying) return;

      if (key === 'm') {
        toggleMute();
        return;
      }
      if (key === 'h') {
        toggleHints();
        return;
      }
      if (key === 'v') {
        toggleVibration();
        return;
      }

      // Let Enter/Space work normally on buttons outside the dial controls
      // (Back, Sound, Hints) instead of hijacking them.
      const target = event.target instanceof Element ? event.target : null;
      const onOtherControl =
        target?.closest('button, a, input, select, textarea') && !target.closest('.dial-controls');

      if (key === 'enter') {
        if (onOtherControl || event.repeat) return;
        event.preventDefault();
        confirmNumber();
      } else if (key === 'arrowleft' || key === 'a') {
        event.preventDefault();
        rotateBy(-1);
      } else if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        rotateBy(1);
      }
    };
  });

  useEffect(() => {
    const listener = (event) => keyHandlerRef.current?.(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /* ---------- Lifecycle ---------- */

  // Preload the reward image and win sounds so nothing lags at the end.
  useEffect(() => {
    const image = new Image();
    image.src = unlockedSafeImage;

    Object.entries(SOUND_FILES).forEach(([name, url]) => {
      soundFiles.current[name] = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
    });
  }, []);

  // Win screen sounds, in order: confetti pops (left and right, matching the
  // two cannons), fanfare, applause sized to the stars, then a chime and buzz
  // per star as each one pops in. With reduced motion there are no cannons,
  // so a single soft pop plays instead.
  // Everything is scheduled with timers so cleanup cancels it cleanly.
  useEffect(() => {
    if (!showOpenedSafe) return undefined;

    const gentle = prefersReducedMotion();
    const applause = APPLAUSE_BY_STARS[winStars] ?? APPLAUSE_BY_STARS[1];

    const timers = [
      setTimeout(() => {
        if (gentle) {
          playClip('pop', { volume: 0.35 });
        } else {
          playClip('pop', { volume: 0.7, pan: -0.7 });
        }
      }, POP_AT_MS),
      setTimeout(playFanfare, FANFARE_AT_MS),
      setTimeout(() => {
        playClip('applause', { volume: applause.volume, stopAfter: applause.length });
      }, APPLAUSE_AT_MS),
    ];

    if (!gentle) {
      timers.push(setTimeout(() => playClip('pop', { volume: 0.7, pan: 0.7 }), POP_AT_MS + 90));
    }

    for (let index = 0; index < winStars; index += 1) {
      timers.push(setTimeout(() => {
        playStarChime(index);
        buzz(HAPTICS.star);
      }, STAR_START_MS + index * STAR_STEP_MS));
    }

    return () => {
      timers.forEach(clearTimeout);
      stopCelebrationSounds();
    };
  }, [showOpenedSafe, winStars, playClip, playFanfare, playStarChime, stopCelebrationSounds, buzz]);

  useEffect(() => {
    return () => {
      stopProximitySound();
      stopCelebrationSounds();
      clearTransition();

      if (audioContext.current) {
        audioContext.current.close().catch(() => {});
        audioContext.current = null;
      }
    };
  }, [clearTransition, stopCelebrationSounds, stopProximitySound]);

  /* ---------- Screens ---------- */

  if (showOpenedSafe) {
    const wrongGuesses = attemptsUsed.reduce((total, used) => total + used, 0);

    return (
      <section className="mechanism-screen opened-screen">
        <Confetti delay={300} />
        <div className="opened-safe-scene">
          <div className="opened-safe-stage">
            <div className="opened-safe-rays" aria-hidden="true" />
            <div className="opened-safe-visual">
              <img
                src={unlockedSafeImage}
                alt="Safe unlocked with its door open"
                className="opened-safe-image"
              />
            </div>
          </div>

          <div className="opened-safe-message">
            <h2 className="opened-title">Vault Unlocked!</h2>

            <StarRating
              stars={winStars}
              startDelayMs={STAR_START_MS}
              stepMs={STAR_STEP_MS}
              className="win-stars"
            />

            <p className="win-tip">{getNextStarTip(winStars)}</p>

            <dl className="win-stats">
              <div className="win-stat">
                <dt>Time left</dt>
                <dd>{formatTime(timeLeft)}</dd>
              </div>
              <div className="win-stat">
                <dt>Wrong guesses</dt>
                <dd>{wrongGuesses}</dd>
              </div>
              <div className={`win-stat ${isNewBest ? 'win-stat-best' : ''}`}>
                <dt>{isNewBest ? 'New best!' : `Best on ${config.label}`}</dt>
                <dd>{formatTime(isNewBest || !bestRecord ? timeLeft : bestRecord.timeLeft)}</dd>
              </div>
            </dl>

            <div className="win-actions">
              <button type="button" className="game-action-button" onClick={restartGame}>Play again</button>
              <button type="button" className="mechanism-back scene-back" onClick={handleBack}>Back to the vault</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (gameOver) {
    const outOfTime = lossReason === 'time';

    return (
      <section className="mechanism-screen">
        <button type="button" className="mechanism-back" onClick={handleBack}>← Back to safe</button>
        <div className="game-over-panel">
          <div className="game-over-icon" aria-hidden="true">{outOfTime ? '⏱️' : '🔒'}</div>
          <p className="mechanism-label">SECURITY SYSTEM ACTIVATED</p>
          <h1>{outOfTime ? "Time's Up" : 'Vault Locked'}</h1>
          <p>
            {outOfTime
              ? `The clock ran out while you were on Lock ${currentLock + 1}.`
              : `You used all ${config.attempts} attempts on Lock ${currentLock + 1}.`}
          </p>
          <p className="game-over-subtitle">The codes have been sealed. Try a new combination.</p>
          <button type="button" className="game-action-button" onClick={restartGame}>Restart Game</button>
        </div>
      </section>
    );
  }

  const unlockedCount = unlockedLocks.filter(Boolean).length;
  const timeIsLow = timeLeft <= config.warning;
  const heat = getHeat(currentNumber, secretCodes[currentLock], config.hearingRange);
  const showHeat = hintsOn && !isUnlocking;

  return (
    <section className={`mechanism-screen ${isUnlocking ? 'is-unlocking' : ''}`}>
      <button type="button" className="mechanism-back" onClick={handleBack}>← Back to safe</button>

      <div className="mechanism-tools">
        <button
          type="button"
          className="tool-toggle"
          aria-pressed={!muted}
          onClick={toggleMute}
          title="Sound (M)"
        >
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          <span className="tool-label">Sound</span>
        </button>
        <button
          type="button"
          className="tool-toggle"
          aria-pressed={hintsOn}
          onClick={toggleHints}
          title="Visual hints (H)"
        >
          <span aria-hidden="true">💡</span>
          <span className="tool-label">Hints</span>
        </button>
        {CAN_VIBRATE && (
          <button
            type="button"
            className="tool-toggle"
            aria-pressed={vibrationOn}
            onClick={toggleVibration}
            title="Vibration (V)"
          >
            <span aria-hidden="true">📳</span>
            <span className="tool-label">Vibration</span>
          </button>
        )}
      </div>

      <p className="mechanism-label">
        VAULT HEIST <span>•</span> {config.label.toUpperCase()}
      </p>

      <div className="vault-game-layout">
        <div className="dial-column">
          <div
            className={`vault-timer ${timeIsLow ? 'vault-timer-critical' : ''}`}
            role="timer"
            aria-label={`${formatTime(timeLeft)} remaining`}
          >
            <div className="vault-timer-row">
              <span>Time left</span>
              <strong>{formatTime(timeLeft)}</strong>
            </div>
            <div className="vault-timer-track">
              <div
                className="vault-timer-fill"
                style={{ width: `${(timeLeft / config.timeLimit) * 100}%` }}
              />
            </div>
            {!timerRunning && timeLeft === config.timeLimit && (
              <p className="vault-timer-note">The clock starts when you turn the dial</p>
            )}
          </div>

          <div
            className="dial-wrap"
            style={{ '--heat': heat.heat, '--heat-color': heat.color }}
          >
            {showHeat && <div className="dial-heat" aria-hidden="true" />}
            {isUnlocking && (
              <>
                <span className="unlock-shockwave" aria-hidden="true" />
                <span className="unlock-shockwave unlock-shockwave-late" aria-hidden="true" />
              </>
            )}

            <div
              ref={housingRef}
              className={[
                'dial-housing',
                pulseRing ? 'dial-confirm-pulse' : '',
                isUnlocking ? 'dial-unlocking' : '',
                isDragging ? 'is-dragging' : '',
                isChecking ? 'is-locked' : '',
              ].join(' ')}
              role="slider"
              aria-label="Combination dial. Drag to turn, or use the arrow keys."
              aria-valuemin={0}
              aria-valuemax={TOTAL_NUMBERS - 1}
              aria-valuenow={currentNumber}
              aria-valuetext={`Code ${formatNumber(currentNumber)}`}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onLostPointerCapture={handlePointerEnd}
            >
              <div className="dial-pointer" />
              <div
                className={`dial-rotator ${isUnlocking ? 'dial-rotator-spinning' : ''}`}
                style={{ transform: `rotate(${-rotation * DEGREES_PER_NUMBER}deg)` }}
                aria-hidden="true"
              >
                {DIAL_MARKS.map((number) => {
                  const angle = number * DEGREES_PER_NUMBER;
                  return (
                    <span key={number} className="dial-slot" style={{ transform: `rotate(${angle}deg)` }}>
                      <span className={`dial-tick ${number % 5 === 0 ? 'major' : ''}`} />
                      {number % 10 === 0 && (
                        <span
                          className="dial-number"
                          style={{ transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
                        >
                          {formatNumber(number)}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>

              <div className="dial-center">
                <div className={`dial-center-ring ${pulseRing ? 'unlock-pulse' : ''}`}>
                  <span>{isUnlocking ? 'OPEN' : isChecking ? '...' : isDragging ? '' : 'DRAG'}</span>
                </div>
              </div>
            </div>
          </div>

          <p className="selected-number">Selected code: <strong>{formatNumber(currentNumber)}</strong></p>

          {showHeat && (
            <div className="heat-meter" style={{ '--heat-color': heat.color }}>
              <span className="heat-bars" aria-hidden="true">
                {HEAT_LEVELS.map((level, index) => (
                  <span key={level.label} className={index < heat.bars ? 'heat-bar-on' : ''} />
                ))}
              </span>
              <span className="heat-label">{heat.label}</span>
            </div>
          )}

          <p className="mechanism-instruction">
            {hintsOn ? 'Drag the dial and watch the glow' : 'Drag the dial and listen for clues'}
          </p>
          <div className="dial-controls">
            <button type="button" onClick={() => rotateBy(-1)} disabled={isChecking}>← Left</button>
            <button type="button" onClick={() => rotateBy(1)} disabled={isChecking}>Right →</button>
            <button type="button" className="confirm-button" onClick={confirmNumber} disabled={isChecking}>Confirm</button>
          </div>
          <p className="mechanism-feedback" aria-live="polite">{feedback}</p>
          <p className="keyboard-hint">
            Keyboard: ← → or A / D to turn · Enter to confirm · M sound · H hints{CAN_VIBRATE ? ' · V vibration' : ''} · Esc back
          </p>
        </div>

        <aside className="locks-panel" aria-label="Vault locks and attempts">
          <p className="locks-panel-title">SECURITY LOCKS</p>
          {Array.from({ length: LOCK_COUNT }, (_, index) => {
            const isUnlocked = unlockedLocks[index];
            const isActive = currentLock === index && !isUnlocked;
            const remaining = config.attempts - attemptsUsed[index];

            return (
              <div
                key={index}
                className={`lock-card ${isUnlocked ? 'lock-card-open' : ''} ${isActive ? 'lock-card-active' : ''}`}
              >
                <div className={`lock-symbol ${isUnlocked ? 'lock-symbol-open' : ''}`} aria-hidden="true">
                  {isUnlocked ? '🔓' : '🔒'}
                </div>
                <div className="lock-details">
                  <div className="lock-title-row">
                    <span className="lock-title">LOCK {index + 1}</span>
                    <span className={`lock-status ${isUnlocked ? 'status-open' : ''}`}>
                      {isUnlocked ? 'OPEN' : isActive ? 'ACTIVE' : 'SEALED'}
                    </span>
                  </div>
                  <div className="attempt-dots" aria-label={`${remaining} attempts remaining`}>
                    {Array.from({ length: config.attempts }, (_, dotIndex) => (
                      <span
                        key={dotIndex}
                        className={`attempt-dot ${dotIndex < remaining ? 'attempt-dot-gold' : 'attempt-dot-dark'}`}
                      />
                    ))}
                  </div>
                  <span className="attempt-caption">
                    {isUnlocked ? 'Code accepted' : `${remaining} attempt${remaining === 1 ? '' : 's'} remaining`}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="lock-progress">
            <div className="lock-progress-heading">
              <span>PROGRESS</span>
              <strong>{unlockedCount}/{LOCK_COUNT}</strong>
            </div>
            <div className="lock-progress-track">
              <div
                className="lock-progress-fill"
                style={{ width: `${(unlockedCount / LOCK_COUNT) * 100}%` }}
              />
            </div>
          </div>
        </aside>
      </div>

      {isUnlocking && <div className="unlock-flash" aria-hidden="true" />}
    </section>
  );
}