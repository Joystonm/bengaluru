import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import type { Festival, Weather } from '../state/store';
import { FESTIVALS, festivalInfo } from '../data/festivals';

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
 *
 * The festivals themselves are written down in `data/festivals.ts`, with the
 * hour each one belongs to and the colour of its light, and this panel asks
 * that file rather than keeping a list of its own. So when the city grows a
 * fifth festival, the panel grows it too.
 */

const WEATHERS: Array<{ id: Weather; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'monsoon', label: 'Monsoon' },
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

/** The everyday city: a few blocks and nothing lit. */
function EverydayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M4 18V10h5v8M9 18V7h6v11M15 18v-5h5v5M3 20h18"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A torch on a pole: the procession at Dasara. */
function TorchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M12 21V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M8.5 10h7l-1.2-2.2a3.4 3.4 0 0 0-4.6 0L8.5 10z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M12 2.5c0 1.5-1.6 2-1.6 3.4 0 1.2 1 2 1.6 2s1.6-.8 1.6-2c0-1.4-1.6-1.9-1.6-3.4z"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** An oil lamp — Deepavali's. */
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

/** A mango leaf, for the garlands hung at Ugadi. */
function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M20 4C10 4 4 8.5 4 14.5c0 2 1 3.5 1 3.5S6.5 12 12 11c0 0-6 1.5-7.5 7"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20 4c-1 5-4 8-8 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A star, for the one over the city at Christmas. */
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M12 2.8 14.4 9l6.8.5-5.2 4.4 1.6 6.6L12 17l-5.6 3.5L8 13.9 2.8 9.5 9.6 9 12 2.8z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The mark that goes with each festival. */
function FestivalIcon({ id }: { id: Festival }) {
  if (id === 'dasara') return <TorchIcon />;
  if (id === 'deepavali') return <LampIcon />;
  if (id === 'ugadi') return <LeafIcon />;
  if (id === 'christmas') return <StarIcon />;
  return <EverydayIcon />;
}

export function ConditionsPanel() {
  const weather = useApp((s) => s.weather);
  const festival = useApp((s) => s.festival);
  const setWeather = useApp((s) => s.setWeather);
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

  const current = festivalInfo(festival);
  const label = current.label;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Conditions: ${weather === 'monsoon' ? 'monsoon' : 'clear'}, ${label}`}
        title={`${weather === 'monsoon' ? 'Monsoon' : 'Clear weather'} · ${label}`}
        className={`nb-icon-btn inline-flex h-9 w-9 items-center justify-center gap-1.5 whitespace-nowrap px-0 md:w-auto md:px-3 ${
          weather !== 'clear' || festival !== 'none' ? 'border-saffron/45 text-saffron' : ''
        }`}
      >
        <span className="flex items-center gap-1">
          {weather === 'monsoon' ? <WeatherIcon weather="monsoon" /> : <WeatherIcon weather="clear" />}
          {festival !== 'none' && (
            <span className="nb-lamp-lit flex" style={{ color: current.accent }}>
              <FestivalIcon id={festival} />
            </span>
          )}
        </span>
        <span className="hidden text-[12px] md:inline">
          {festival !== 'none' ? label : weather === 'monsoon' ? 'Monsoon' : 'Clear'}
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

              {/*
                * The everyday city gets a row of its own, and the four
                * festivals sit under it in two columns. Five names will not
                * fit on one line of pills without shrinking to nothing, and
                * a festival you cannot read is a festival you cannot pick.
                */}
              <div className="mt-2 flex flex-col gap-1.5">
                {FESTIVALS.filter((f) => f.id === 'none').map((f) => (
                  <FestivalChip key={f.id} id={f.id} label={f.label} colour={f.colour} />
                ))}
                <div className="grid grid-cols-2 gap-1.5">
                  {FESTIVALS.filter((f) => f.id !== 'none').map((f) => (
                    <FestivalChip key={f.id} id={f.id} label={f.label} colour={f.colour} />
                  ))}
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-mist-400">{current.note}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One festival in the list.
 *
 * The chip is the colour of the festival's own light, so that the panel
 * shows what picking it will do to the city before it is picked.
 */
function FestivalChip({
  id,
  label,
  colour,
}: {
  id: Festival;
  label: string;
  colour: string;
}) {
  const festival = useApp((s) => s.festival);
  const setFestival = useApp((s) => s.setFestival);
  const on = festival === id;

  return (
    <button
      type="button"
      onClick={() => setFestival(id)}
      aria-pressed={on}
      className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
        on
          ? 'border-transparent font-medium'
          : 'border-white/10 bg-ink-900/50 text-mist-300 hover:text-mist-100'
      }`}
      style={on ? { backgroundColor: colour, color: '#0b0f14' } : undefined}
    >
      <span className="flex shrink-0" style={on ? undefined : { color: colour }}>
        <FestivalIcon id={id} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
