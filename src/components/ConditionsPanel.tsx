import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import type { Festival, Weather } from '../state/store';

/**
 * The weather and the festival.
 *
 * Two things change the way a city looks without changing the city: the
 * weather over it, and the festival it is dressed for. Both live here,
 * behind one button, because neither is something a visitor changes often
 * and both are things that need explaining.
 *
 * The button carries the current state as well as opening the panel — a
 * visitor who has never seen the panel should still be able to tell that
 * the city is in the rain.
 */

const WEATHERS: Array<{ id: Weather; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'monsoon', label: 'Monsoon' },
];

const FESTIVALS: Array<{ id: Festival; label: string; note: string }> = [
  { id: 'none', label: 'Everyday', note: 'The city as it is' },
  { id: 'dasara', label: 'Dasara', note: 'The Vidhana Soudha lit for the procession' },
  { id: 'deepavali', label: 'Deepavali', note: 'Lamps along every street' },
];

/** A sun, a cloud with rain under it, and a lamp. */
function WeatherIcon({ weather }: { weather: Weather }) {
  if (weather === 'monsoon') {
    return (
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          d="M7 14.5a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.4 1.6A3.5 3.5 0 0 1 17.5 14.5H7z"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M9 17.5 8 20M13 17.5 12 20M17 17.5 16 20"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** An oil lamp — the Deepavali one, the Dasara one is the same lamp. */
function LampIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M6 12h12l-2.2 4.4a2 2 0 0 1-1.8 1.1H10a2 2 0 0 1-1.8-1.1L6 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M12 9.5c0-1.6 1.3-2.2 1.3-3.4 0 0-1.3.5-1.3 2 0-1-.6-1.6-1.3-1.6 0 1.1 1.3 1.7 1.3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ConditionsPanel() {
  const weather = useApp((s) => s.weather);
  const festival = useApp((s) => s.festival);
  const setWeather = useApp((s) => s.setWeather);
  const setFestival = useApp((s) => s.setFestival);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The panel is a menu, so it closes when the visitor clicks away from it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const festivalNote = FESTIVALS.find((f) => f.id === festival)?.note ?? '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Conditions: ${weather === 'monsoon' ? 'monsoon' : 'clear'}, ${
          FESTIVALS.find((f) => f.id === festival)?.label ?? 'everyday'
        }`}
        title={`${weather === 'monsoon' ? 'Monsoon' : 'Clear weather'} · ${
          FESTIVALS.find((f) => f.id === festival)?.label ?? 'Everyday'
        }`}
        className={`nb-icon-btn inline-flex h-9 w-9 items-center justify-center gap-1.5 whitespace-nowrap px-0 md:w-auto md:px-3 ${
          weather !== 'clear' || festival !== 'none'
            ? 'border-saffron/45 text-saffron'
            : ''
        }`}
      >
        <span className="flex items-center gap-1">
          {weather === 'monsoon' ? <WeatherIcon weather="monsoon" /> : <WeatherIcon weather="clear" />}
          {festival !== 'none' && (
            <span className="nb-lamp-lit flex">
              <LampIcon />
            </span>
          )}
        </span>
        <span className="hidden text-[12px] md:inline">
          {festival !== 'none'
            ? (FESTIVALS.find((f) => f.id === festival)?.label ?? '')
            : weather === 'monsoon'
              ? 'Monsoon'
              : 'Clear'}
        </span>
      </button>

      {open && (
        <div
          className="nb-panel nb-fade-up absolute right-0 top-full z-50 mt-2 w-[21rem] rounded-lg p-4"
          role="group"
          aria-label="Weather and festival"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-saffron">
              {weather === 'monsoon' ? (
                <WeatherIcon weather="monsoon" />
              ) : (
                <WeatherIcon weather="clear" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="nb-label">Weather</p>
              <div className="mt-2 flex gap-1 rounded-full border border-white/10 bg-ink-900/60 p-1">
                {WEATHERS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWeather(w.id)}
                    aria-pressed={weather === w.id}
                    className={`flex-1 rounded-full px-2 py-1.5 text-[12px] transition-colors ${
                      weather === w.id
                        ? 'bg-saffron/85 text-ink-950'
                        : 'text-mist-300 hover:text-mist-100'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="nb-hairline my-3.5" />

          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-saffron">
              <LampIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="nb-label">Festival</p>
              <div className="mt-2 flex gap-1 rounded-full border border-white/10 bg-ink-900/60 p-1">
                {FESTIVALS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFestival(f.id)}
                    aria-pressed={festival === f.id}
                    className={`flex-1 rounded-full px-2 py-1.5 text-[12px] transition-colors ${
                      festival === f.id
                        ? 'bg-saffron/85 text-ink-950'
                        : 'text-mist-300 hover:text-mist-100'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-mist-400">{festivalNote}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
