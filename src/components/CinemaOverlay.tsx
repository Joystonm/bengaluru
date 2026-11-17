import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { SCENES, ENDING_TEXT } from '../three/cinematic';
import { ambience } from '../audio/ambience';

/**
 * The Play-mode overlay.
 *
 * Scene titles, the narration subtitle, and the transport controls. The
 * camera itself is driven by the cinematic director inside the 3D scene — the
 * overlay only reports and controls.
 */
export function CinemaOverlay() {
  const mode = useApp((s) => s.mode);
  const cinema = useApp((s) => s.cinema);
  const setCinema = useApp((s) => s.setCinema);
  const setMode = useApp((s) => s.setMode);
  const [showEnding, setShowEnding] = useState(false);

  const scene = SCENES[cinema.sceneIndex] ?? SCENES[0];
  const progress = cinema.duration > 0 ? Math.min(1, cinema.elapsed / cinema.duration) : 0;

  // The closing card holds for a few seconds before the city opens up.
  useEffect(() => {
    if (mode !== 'cinematic') {
      setShowEnding(false);
      return;
    }
    const sceneIndex = cinema.sceneIndex;
    if (sceneIndex === SCENES.length - 1 && cinema.elapsed > cinema.duration - 5) {
      setShowEnding(true);
    } else {
      setShowEnding(false);
    }
  }, [mode, cinema.sceneIndex, cinema.elapsed, cinema.duration]);

  if (mode !== 'cinematic') return null;

  const toggle = () => {
    const next = !cinema.playing;
    setCinema({ playing: next });
    if (next) {
      ambience.setScene(cinema.sceneIndex);
      if (cinema.narration) ambience.speak(scene.narration);
    } else {
      ambience.stopSpeech();
    }
  };

  const skip = () => {
    const next = cinema.sceneIndex + 1;
    if (next >= SCENES.length) {
      setCinema({ playing: false, sceneIndex: 0, elapsed: 0 });
      setMode('explore');
      return;
    }
    setCinema({ sceneIndex: next, elapsed: 0, playing: true });
    ambience.setScene(next);
    ambience.chime();
    if (cinema.narration) ambience.speak(SCENES[next].narration);
  };

  const restart = () => {
    setCinema({ sceneIndex: 0, elapsed: 0, playing: true });
    ambience.setScene(0);
    ambience.chime();
    if (cinema.narration) ambience.speak(SCENES[0].narration);
  };

  const exit = () => {
    ambience.stopSpeech();
    setCinema({ playing: false });
    setMode('explore');
  };

  const toggleSound = () => {
    const muted = !cinema.muted;
    setCinema({ muted });
    ambience.setMuted(muted);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex flex-col justify-between">
      {/* Letterbox */}
      <div className="h-8 shrink-0 bg-ink-950/85 backdrop-blur-sm sm:h-12" />

      <div className="flex flex-1 flex-col justify-between overflow-hidden">
        {/* Scene title */}
        <div className="relative shrink-0">
          <div className="nb-cine-top pointer-events-none absolute inset-x-0 top-0 h-[clamp(9rem,26vh,15rem)]" />
          <div className="nb-fade relative px-6 pt-4 sm:px-12 sm:pt-8">
            <div className="flex items-baseline gap-4">
              <span className="nb-over-city font-mono text-[11px] tabular-nums text-saffron">
                {String(cinema.sceneIndex + 1).padStart(2, '0')}
              </span>
              <h2 className="nb-display nb-over-city text-[clamp(1.6rem,3.6vw,3rem)] leading-none tracking-tight text-mist-100">
                {scene.title}
              </h2>
            </div>
            <p className="nb-display nb-over-city mt-2 pl-[2.1rem] text-[clamp(0.95rem,1.7vw,1.25rem)] italic text-mist-200">
              {scene.subtitle}
            </p>
            <p className="nb-over-city mt-2 pl-[2.1rem] font-mono text-[10px] uppercase tracking-[0.14em] text-mist-300">
              {scene.places.join('  ·  ')}
            </p>
          </div>
        </div>

        {/* Ending card */}
        {showEnding && (
          <div className="nb-fade pointer-events-none absolute inset-0 grid place-items-center">
            <p className="nb-display nb-over-city text-center text-[clamp(2rem,6vw,4.4rem)] leading-tight text-mist-100">
              {ENDING_TEXT}
            </p>
          </div>
        )}

        {/* Narration subtitle */}
        {!showEnding && (
          <div className="relative shrink-0">
            <div className="nb-cine-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[clamp(7rem,22vh,12rem)]" />
            <div className="relative mx-auto mb-6 max-w-2xl px-6 text-center sm:mb-10">
              <p className="nb-fade nb-over-city text-[13px] leading-relaxed text-mist-100 sm:text-[14.5px]">
                {scene.narration}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="pointer-events-auto border-t border-white/8 bg-ink-950/80 px-4 py-3 backdrop-blur-md sm:px-8 sm:py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            className="nb-icon-btn"
            aria-label={cinema.playing ? 'Pause' : 'Resume'}
          >
            {cinema.playing ? (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={skip}
            className="nb-icon-btn"
            aria-label="Skip to the next scene"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path d="M6 5l9 7-9 7zM16 5h2.5v14H16z" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            onClick={restart}
            className="nb-icon-btn"
            aria-label="Restart the journey"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"
                stroke="currentColor"
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={toggleSound}
            className="nb-icon-btn"
            aria-label={cinema.muted ? 'Unmute' : 'Mute'}
          >
            {cinema.muted ? (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
                <path
                  d="m16 9 5 6M21 9l-5 6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" />
                <path
                  d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>

          {/* Scene progress */}
          <div className="flex flex-1 items-center gap-3 px-1">
            <div className="h-px flex-1 overflow-hidden bg-white/12">
              <div
                className="h-full bg-saffron transition-[width] duration-100 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10.5px] tabular-nums text-mist-400">
              {String(cinema.sceneIndex + 1).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}
            </span>
          </div>

          <button
            type="button"
            onClick={exit}
            className="nb-btn nb-btn-ghost h-9 px-4 text-[12px]"
            aria-label="Exit the journey"
          >
            Exit
          </button>
        </div>

        {/* Scene dots */}
        <div className="mx-auto mt-3 flex max-w-5xl items-center justify-center gap-1.5">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setCinema({ sceneIndex: i, elapsed: 0, playing: true });
                ambience.setScene(i);
                ambience.chime();
                if (cinema.narration) ambience.speak(s.narration);
              }}
              aria-label={s.title}
              className={`h-1 rounded-full transition-all ${
                i === cinema.sceneIndex ? 'w-6 bg-saffron' : 'w-1.5 bg-white/25 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
