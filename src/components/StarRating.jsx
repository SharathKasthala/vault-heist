const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';

// Three stars. Earned stars pop in one at a time when startDelayMs is set;
// use the "small" size for inline badges like the home screen record.
export default function StarRating({ stars, total = 3, startDelayMs = null, stepMs = 0, size = 'large', className = '' }) {
  const animated = startDelayMs !== null;

  return (
    <div
      className={`star-rating star-rating-${size} ${animated ? 'star-rating-animated' : ''} ${className}`}
      role="img"
      aria-label={`${stars} of ${total} stars`}
    >
      {Array.from({ length: total }, (_, index) => {
        const earned = index < stars;
        // Unearned stars fade in quietly after the earned ones.
        const delay = animated ? startDelayMs + (earned ? index : stars) * stepMs : 0;

        return (
          <svg
            key={index}
            className={`star ${earned ? 'star-earned' : 'star-empty'}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={animated ? { animationDelay: `${delay}ms` } : undefined}
          >
            <path d={STAR_PATH} />
          </svg>
        );
      })}
    </div>
  );
}
