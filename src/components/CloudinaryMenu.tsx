import { useEffect, useRef, useState } from 'react';
import { EngineRoom } from './EngineRoom';
import { PostcardWall } from './PostcardWall';

/**
 * The Cloudinary button.
 *
 * Two things live behind it, and both of them are about what the cloud is
 * doing for this city rather than about the city itself:
 *
 *   · The engine room — what this account can do, what the last delivery
 *     address asked for, and which Cloudinary features have genuinely been
 *     used.
 *   · The postcard wall — every picture of the city that a visitor has sent,
 *     listed by the cloud rather than kept by this page.
 *
 * They are behind one button because the top bar is already crowded and
 * because they belong together: one is the machinery, the other is what the
 * machinery has made.
 */

/** A cloud, with the city under it. */
function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M7 17.5h10.2a3.6 3.6 0 0 0 .4-7.2A5.2 5.2 0 0 0 7.6 9 3.8 3.8 0 0 0 7 17.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M9.5 20.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CloudinaryMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'engine' | 'wall' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The menu closes when the visitor clicks away from it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Escape backs out of the panel first, and out of the menu second.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panel) {
        e.preventDefault();
        setPanel(null);
      } else if (menuOpen) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, menuOpen]);

  /** Open a panel and get the menu out of the way. */
  const openPanel = (which: 'engine' | 'wall') => {
    setMenuOpen(false);
    setPanel(which);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        aria-label="What Cloudinary is doing for this city"
        title="What Cloudinary is doing for this city"
        className="nb-icon-btn inline-flex h-9 w-9 items-center justify-center gap-1.5 whitespace-nowrap px-0 md:w-auto md:px-3"
      >
        <CloudIcon />
        <span className="hidden text-[12px] md:inline">Cloudinary</span>
      </button>

      {menuOpen && (
        <div
          className="nb-panel nb-fade-up absolute right-0 top-full z-50 mt-2 w-[19rem] rounded-lg p-2"
          role="menu"
          aria-label="Cloudinary"
        >
          <MenuEntry
            title="The engine room"
            note="What this account can do, what the last delivery address asked for, and which features have been used."
            onClick={() => openPanel('engine')}
          />
          <MenuEntry
            title="The postcard wall"
            note="Every picture of the city a visitor has sent — listed by the cloud, not kept by this page."
            onClick={() => openPanel('wall')}
          />
        </div>
      )}

      {panel === 'engine' && <EngineRoom onClose={() => setPanel(null)} />}
      {panel === 'wall' && <PostcardWall onClose={() => setPanel(null)} />}
    </div>
  );
}

/** One entry in the menu. */
function MenuEntry({
  title,
  note,
  onClick,
}: {
  title: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/5"
    >
      <span className="block text-[12.5px] text-mist-100">{title}</span>
      <span className="mt-0.5 block text-[10.5px] leading-relaxed text-mist-400">{note}</span>
    </button>
  );
}
