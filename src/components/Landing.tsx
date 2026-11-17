import { useEffect } from 'react';
import { useApp } from '../state/store';
import { ambience } from '../audio/ambience';

/**
 * The opening screen.
 *
 * Almost nothing on it: the city itself is the picture, so the type sits at
 * the edges and the Play button is the only thing that really calls for
 * attention.
 */
export function Landing() {
  const mode = useApp((s) => s.mode);

  const play = () => {
    // The audio is started, but never awaited: a browser that refuses to run
    // the AudioContext must not be able to stop the journey from starting.
    void ambience.start();
    ambience.setScene(0);
    useApp.getState().setCinema({ playing: true, sceneIndex: 0, elapsed: 0, duration: 24 });
    useApp.getState().setMode('cinematic');
  };

  const explore = () => {
    useApp.getState().setMode('explore');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void play();      }
    };
    if (mode === 'landing') window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex flex-col justify-between">
      {/* Top */}
      <div className="nb-sheen pointer-events-none relative h-1/2">
        <div className="nb-fade-up absolute left-6 top-6 sm:left-10 sm:top-10">
          <span className="nb-label block text-saffron/85">Bengaluru · Karnataka</span>
        </div>
      </div>

      {/* Bottom */}
      <div className="relative">
        <div className="nb-sheen-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[22rem]" />

        <div className="nb-fade-up relative flex flex-col gap-8 px-6 pb-10 sm:px-10 sm:pb-12">
          <div className="nb-over-city">
            <h1 className="nb-display text-[clamp(2.6rem,7vw,5.4rem)] leading-[0.95] font-light tracking-tight text-mist-100">
              Namma&nbsp;Bengaluru
            </h1>
            <p className="nb-display mt-3 text-[clamp(1.05rem,2.4vw,1.6rem)] italic text-mist-300">
              Every street has a story.
            </p>
          </div>

          <div className="pointer-events-auto flex flex-wrap items-center gap-3">
            <button id="nb-play" type="button" className="nb-btn nb-btn-primary" onClick={play}>
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
              </svg>
              Play the journey
            </button>

            <button id="nb-explore" type="button" className="nb-btn nb-btn-ghost" onClick={explore}>
              Explore freely
            </button>

            <button
              id="nb-search"
              type="button"
              className="nb-btn nb-btn-ghost"
              onClick={() => {
                useApp.getState().setSearchOpen(true);
              }}
            >
              Search landmarks
            </button>
          </div>

          <p className="nb-over-city max-w-xl text-[11px] leading-relaxed text-mist-300">
            A three-dimensional twin of Bengaluru, built from OpenStreetMap and Overture Maps
            building footprints, AWS Terrain Tiles elevation, and photographs from Wikimedia
            Commons. Drag to orbit · scroll to zoom · click a marker to read a story.
          </p>

          <div className="nb-over-city max-w-xl text-[11px] leading-relaxed text-mist-400">
            <p>
              The voice that narrates the journey is Inworld&rsquo;s, and the model behind it
              is served by GMI Cloud. The city itself is built from open data and real
              photographs.
            </p>
            <p className="mt-1.5">
              <a
                href="https://inworld.ai"
                target="_blank"
                rel="noreferrer noopener"
                className="text-mist-300 underline decoration-white/25 underline-offset-2 transition-colors hover:text-saffron"
              >
                Inworld AI
              </a>
              <span className="text-mist-500">{` · voice`}</span>
              <a
                href="https://gmicloud.ai"
                target="_blank"
                rel="noreferrer noopener"
                className="text-mist-300 underline decoration-white/25 underline-offset-2 transition-colors hover:text-saffron"
              >
                GMI Cloud
              </a>
              <span className="text-mist-500">{` · models`}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
