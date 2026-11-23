import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { useFilm } from '../state/filmStore';
import { usePostcard } from '../state/postcardStore';
import { rig } from '../three/rig';
import { setFocusGoal } from '../three/focus';
import { localToLonLat } from '../core/terrain';
import { ConditionsPanel } from './ConditionsPanel';
import { CloudinaryMenu } from './CloudinaryMenu';

const TIMES: Array<'dawn' | 'day' | 'dusk' | 'night'> = ['dawn', 'day', 'dusk', 'night'];

/**
 * Free-exploration HUD.
 *
 * Deliberately quiet: a wordmark, a search field, a time-of-day switch and a
 * way back to the overview. Everything else lives in the city itself.
 */
export function Hud() {
  const mode = useApp((s) => s.mode);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const setTimeOfDay = useApp((s) => s.setTimeOfDay);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const setMode = useApp((s) => s.setMode);
  const selectedId = useApp((s) => s.selectedId);
  const [coords, setCoords] = useState({ lat: 12.9716, lon: 77.5946, alt: 0 });

  useEffect(() => {
    if (mode !== 'explore') return;
    const id = window.setInterval(() => {
      const [lon, lat] = localToLonLat(rig.target.x, rig.target.y);
      setCoords({ lat, lon, alt: rig.distance });
    }, 400);
    return () => window.clearInterval(id);
  }, [mode]);

  if (mode !== 'explore') return null;

  const overview = () => {
    setFocusGoal({
      target: { x: -260, y: 0, z: -400 },
      distance: 5200,
      azimuth: 0.62,
      polar: 0.62,
      fov: 46,
      duration: 1.8,
    });
  };

  const play = async () => {
    const { ambience } = await import('../audio/ambience');
    await ambience.start();
    ambience.setScene(0);
    useApp.getState().setCinema({ playing: true, sceneIndex: 0, elapsed: 0, duration: 24 });
    setMode('cinematic');
  };

  /**
   * Take a postcard of the view.
   *
   * The frame is taken from inside the canvas, so all this has to do is ask
   * for it; the capture, the upload and the caption are the postcard's own
   * business.
   */
  const postcard = () => {
    const card = usePostcard.getState();
    card.setOpen(true);
    card.begin();
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {/*
        Scrims.

        The city is a bright concrete plain at midday and the HUD type sits
        straight on it, so the top and bottom edges carry a soft wash. It is
        a gradient rather than a bar: the frame should still read as an open
        city, not as an interface with a header and a footer.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink-950/50 via-ink-950/22 to-transparent" />
      <div className="nb-sheen-bottom pointer-events-none absolute inset-x-0 bottom-0 h-44" />

      {/* Top bar */}
      <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 sm:gap-4 sm:p-6">
        <button
          type="button"
          onClick={overview}
          className="nb-over-city min-w-0 text-left transition-opacity hover:opacity-80"
          aria-label="Return to the city overview"
        >
          <span className="nb-display block truncate text-[15px] leading-none text-mist-100 sm:text-lg">
            Namma Bengaluru
          </span>
          <span className="nb-label mt-1 hidden text-mist-300 sm:block">
            Every street has a story
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            className="nb-btn nb-btn-ghost h-9 w-9 px-0 text-[12px] sm:w-auto sm:px-3.5"
            onClick={() => setSearchOpen(true)}
            aria-label="Search landmarks"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Search</span>
          </button>

          {/*
            The time-of-day switch. Its own pill rather than a round icon
            button, because it holds four controls and a square icon button
            has no room for them.
          */}
          <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-ink-900/55 p-1 backdrop-blur-md">
            {TIMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTimeOfDay(t)}
                aria-label={t}
                title={t}
                className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                  t === timeOfDay ? 'bg-saffron/85 text-ink-950' : 'text-mist-300 hover:text-mist-100'
                }`}
              >
                <span className="sr-only">{t}</span>
                <span
                  className="block h-2 w-2 rounded-full"
                  style={{
                    background:
                      t === 'dawn'
                        ? '#e8a33d'
                        : t === 'day'
                          ? '#f4f1ea'
                          : t === 'dusk'
                            ? '#c4553b'
                            : '#5b6b8c',
                  }}
                />
              </button>
            ))}
          </div>

          {/*
            The weather and the festival. One button, because a visitor
            changes both rarely and both need a sentence of explanation.
          */}
          <ConditionsPanel />

          {/*
            What the cloud is doing for this city: the features, the
            delivery addresses, and the wall of postcards everybody has sent.
          */}
          <CloudinaryMenu />

          {/*
            A postcard of this exact view.

            The picture is taken from inside the canvas and sent to the cloud,
            which writes the caption onto it and hands it back.
          */}
          <button
            type="button"
            className="nb-icon-btn"
            onClick={postcard}
            aria-label="Take a postcard of this view"
            title="Take a postcard of this view"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <rect
                x="2.5"
                y="5.5"
                width="19"
                height="13"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
              />
              <path
                d="M5 16l4.2-4.2a1.6 1.6 0 0 1 2.3 0L16 16"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="9" cy="9.5" r="1.5" fill="currentColor" />
              <path d="M17.5 9.5h2.5M17.5 12h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          <button type="button" className="nb-icon-btn" onClick={overview} aria-label="City overview">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M4 13 12 5l8 8M6.5 11.5V20h11v-8.5"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/*
            Film the city.

            The recorder lives inside the canvas, so this button only has to
            ask it to start; what it records, and where the film is
            delivered afterwards, are the recorder's business.
          */}
          <button
            type="button"
            className="nb-icon-btn"
            onClick={() => useFilm.getState().begin()}
            aria-label="Record a film of the city"
            title="Record a film of the city"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <rect
                x="2.5"
                y="6.5"
                width="13"
                height="11"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
              />
              <path
                d="M15.5 11l6-3.2v8.4l-6-3.2z"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinejoin="round"
              />
              <circle cx="9" cy="12" r="2.6" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            className="nb-icon-btn"
            onClick={() => void play()}
            aria-label="Play the journey"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-6">
        <div className="nb-over-city hidden text-[11px] leading-relaxed text-mist-400 sm:block">
          <p>Drag to orbit · shift-drag to pan · scroll to zoom</p>
          <p>Click a marker for its story · press S to search</p>
        </div>

        <div className="nb-over-city ml-auto text-right font-mono text-[10.5px] tabular-nums text-mist-400">
          <p>
            {coords.lat.toFixed(4)}° N · {coords.lon.toFixed(4)}° E
          </p>
          <p>
            {coords.alt < 1000
              ? `${Math.round(coords.alt)} m altitude`
              : `${(coords.alt / 1000).toFixed(2)} km altitude`}
          </p>
        </div>
      </div>

      {selectedId === null && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 hidden -translate-x-1/2 sm:bottom-20 sm:block">
          <span className="nb-chip">Press S to search landmarks</span>
        </div>
      )}
    </div>
  );
}
