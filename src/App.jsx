import { useState } from "react";
import "./App.css";
import safeImage from "./assets/images/safe.webp";
import SafeMechanism from "./components/SafeMechanism.jsx";
import StarRating from "./components/StarRating.jsx";
import { formatTime, readStorage, writeStorage } from "./utils.js";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  describeDifficulty,
  getDifficulty,
} from "./difficulty.js";

const DIFFICULTY_KEY = "vault-difficulty";
const RECORDS_KEY = "vault-records";
const OLD_BEST_KEY = "vault-best-time-left";

// Records are kept per difficulty: { normal: { timeLeft, stars }, ... }.
// Older versions saved a single best time, which is moved over to Normal.
function loadRecords() {
  const saved = readStorage(RECORDS_KEY, null);
  if (saved && typeof saved === "object") return saved;

  const oldBest = readStorage(OLD_BEST_KEY, null);
  return typeof oldBest === "number"
    ? { normal: { timeLeft: oldBest, stars: 0 } }
    : {};
}

function loadDifficulty() {
  const saved = readStorage(DIFFICULTY_KEY, DEFAULT_DIFFICULTY);
  return DIFFICULTIES[saved] ? saved : DEFAULT_DIFFICULTY;
}

const App = () => {
  const [showMechanism, setShowMechanism] = useState(false);
  const [difficulty, setDifficulty] = useState(loadDifficulty);
  const [records, setRecords] = useState(loadRecords);

  const config = getDifficulty(difficulty);
  const record = records[difficulty] ?? null;

  function chooseDifficulty(key) {
    setDifficulty(key);
    writeStorage(DIFFICULTY_KEY, key);
  }

  // Best run = most time left when the vault opened; stars keep their own best.
  function handleWin({ timeLeft, stars }) {
    const previous = records[difficulty];
    const next = {
      timeLeft: Math.max(previous?.timeLeft ?? -1, timeLeft),
      stars: Math.max(previous?.stars ?? 0, stars),
    };

    if (
      !previous ||
      next.timeLeft !== previous.timeLeft ||
      next.stars !== previous.stars
    ) {
      const updated = { ...records, [difficulty]: next };
      setRecords(updated);
      writeStorage(RECORDS_KEY, updated);
    }
  }

  return (
    <main className="game-world">
      <header className="game-header">
        <span className="brand">
          <img src="/logo.png" alt="" className="brand-logo" />
        </span>
        <span className="status">ONLINE</span>
      </header>

      {!showMechanism ? (
        <section className="safe-scene">
          <div className="scene-title">
          {/* <img src='/logo.png' alt='' className='title-logo' /> */}
            <h1>VAULT HEIST</h1>
            <p className="scene-subtitle">Something mysterious awaits...</p>
          </div>

          {/* Hover, keyboard focus and touch are all handled in CSS. */}
          <div className="safe-container">
            <img
              src={safeImage}
              alt="Locked vault safe"
              className="safe-image"
            />

            <button
              type="button"
              className="unlock-button"
              onClick={() => setShowMechanism(true)}
            >
              UNLOCK SAFE
            </button>
          </div>

          <div className="difficulty-panel">
            <div
              className="difficulty-picker"
              role="group"
              aria-label="Difficulty"
            >
              {Object.entries(DIFFICULTIES).map(([key, level]) => (
                <button
                  key={key}
                  type="button"
                  className="difficulty-option"
                  aria-pressed={difficulty === key}
                  onClick={() => chooseDifficulty(key)}
                >
                  {level.label}
                </button>
              ))}
            </div>
            <p className="difficulty-summary">{describeDifficulty(config)}</p>

            {record && (
              <p className="best-run">
                <span>
                  Best on {config.label}: {formatTime(record.timeLeft)} to spare
                </span>
                {record.stars > 0 && (
                  <StarRating stars={record.stars} size="small" />
                )}
              </p>
            )}
          </div>

          <p className="interaction-hint">
            <span className="hint-pointer">
              HOVER OVER THE SAFE TO INTERACT
            </span>
            <span className="hint-touch">TAP UNLOCK SAFE TO BEGIN</span>
          </p>
        </section>
      ) : (
        <SafeMechanism
          difficulty={difficulty}
          bestRecord={record}
          onBack={() => setShowMechanism(false)}
          onWin={handleWin}
        />
      )}

      <footer className="game-footer">
        MINI GAME STORE <span>•</span> VAULT HEIST
      </footer>
    </main>
  );
};

export default App;
