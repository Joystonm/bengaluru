import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../state/store';
import type { Landmark } from '../data/landmarks';
import { landmarkThumbResponsive, photoFallback } from '../cloudinary/imageDelivery';
import { focusLandmark } from '../three/focus';

/**
 * Landmark search.
 *
 * Searches the researched database by name, Kannada name, category and
 * subcategory.
 */
export function SearchPanel() {
  const open = useApp((s) => s.searchOpen);
  const query = useApp((s) => s.searchQuery);
  const setQuery = useApp((s) => s.setSearchQuery);
  const setOpen = useApp((s) => s.setSearchOpen);
  const select = useApp((s) => s.select);
  const landmarks = useApp((s) => s.landmarks);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  /** The landmarks that are actually inside the city boundary. */
  const poolCount = useMemo(
    () => landmarks.filter((l) => !l.outsideBengaluru).length,
    [landmarks],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = landmarks.filter((l) => !l.outsideBengaluru);
    if (!q) return pool.slice(0, 40);
    return pool
      .map((l) => {
        const hay = `${l.name} ${l.kannadaName ?? ''} ${l.category} ${l.subcategory ?? ''}`.toLowerCase();
        const i = hay.indexOf(q);
        return { l, score: i < 0 ? Infinity : i - (l.name.toLowerCase().startsWith(q) ? 100 : 0) };
      })
      .filter((r) => r.score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((r) => r.l);
  }, [query, landmarks]);

  if (!open) return null;

  const choose = (landmark: Landmark) => {
    select(landmark.id);
    setOpen(false);
    if (landmark.x !== null && landmark.y !== null) focusLandmark(landmark);
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-ink-950/70 px-4 pt-[12vh] backdrop-blur-md">
      <div
        className="nb-panel nb-fade-up w-full max-w-2xl overflow-hidden rounded-lg"
        role="dialog"
        aria-label="Search landmarks"
      >
        <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
          <svg viewBox="0 0 24 24" width="17" height="17" className="text-mist-400" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
            <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search for a landmark"
            placeholder={`Search ${poolCount} landmarks — Cubbon Park, Lalbagh, Kempegowda…`}
            className="flex-1 bg-transparent text-[14px] text-mist-100 outline-none placeholder:text-mist-500"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="nb-label transition-colors hover:text-mist-100"
          >
            Esc
          </button>
        </div>

        <div className="nb-scroll max-h-[54vh] overflow-y-auto">
          {results.length === 0 && (
            <p className="px-5 py-8 text-center text-[13px] text-mist-400">
              Nothing matches “{query}”.
            </p>
          )}
          <ul>
            {results.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => choose(l)}
                  className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-white/4"
                >
                  {l.photos.length > 0 &&
                    (() => {
                      const thumb = landmarkThumbResponsive(l.id, l.photos[0].src, '44px');
                      return (
                        <img
                          src={thumb.src}
                          srcSet={thumb.srcSet || undefined}
                          sizes={thumb.sizes || undefined}
                          onError={photoFallback(l.id, l.photos[0].src)}
                          alt=""
                          width={44}
                          height={44}
                          decoding="async"
                          className="h-11 w-11 shrink-0 rounded-sm object-cover"
                        />
                      );
                    })()}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-mist-100">{l.name}</span>
                    <span className="block truncate text-[11px] text-mist-400">
                      {l.category}
                      {l.subcategory ? ` · ${l.subcategory}` : ''}
                    </span>
                  </span>
                  {l.kannadaName && (
                    <span className="hidden max-w-[11rem] shrink-0 truncate text-[13px] text-saffron/70 sm:block">
                      {l.kannadaName}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
