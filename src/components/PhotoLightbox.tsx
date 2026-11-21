import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  publicFull,
  publicGenerated,
  publicRegion,
} from '../cloudinary/imageDelivery';
import { PHOTO_STYLES, styleById } from '../cloudinary/effects';
import { supports, supportsNamed } from '../cloudinary/capabilities';
import { shareCardUrl } from '../cloudinary/shareCard';

/**
 * The photograph viewer.
 *
 * A photograph on its own is 1280 pixels across. Shown full-screen on a
 * modern display that is a little more than one screen-width of detail, and
 * zooming it further would only magnify pixels that are not there.
 *
 * So the viewer asks Cloudinary for the part of the photograph it is
 * actually showing: the visible rectangle is worked out in the coordinates
 * of the original, and Cloudinary crops that rectangle out of the original
 * and delivers it at the size it is displayed. The detail on a zoom comes
 * out of the photograph rather than out of a magnified copy of it.
 *
 * The viewer is rendered through a portal at the end of the document. It
 * lives inside the landmark panel, and the panel carries a transform and a
 * backdrop filter — either of which makes it the containing block for
 * anything positioned `fixed`, so a `fixed inset-0` viewer would be laid out
 * inside the panel and clipped by it. A portal puts it back in the viewport,
 * which is where a full-screen viewer belongs.
 */

/** One photograph the viewer can show. */
export interface LightboxPhoto {
  /** The Cloudinary public ID of the photograph. */
  publicId: string;
  /** The path relative to /assets/landmarks/, used as the local fallback. */
  src: string;
  /**
   * The original photograph on this server.
   *
   * The viewer asks the cloud for the photograph; this is what it shows if
   * the cloud cannot answer. Without it a failed delivery leaves the viewer
   * with nothing at all — an empty frame and no way back to the picture.
   */
  localFallback?: string;
  /** The Commons title, for the caption. */
  title: string;
  /** The credit line, shown under the photograph. */
  credit: string;
  /** The size of the original photograph, in pixels. */
  width: number | null;
  height: number | null;
  /** The landmark the photograph belongs to, for the share card. */
  landmarkName?: string;
  /** The kind of landmark, for the share card's kicker line. */
  landmarkCategory?: string;
}

export interface PhotoLightboxProps {
  photos: LightboxPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** The zoom levels the viewer steps through. */
const ZOOM_STEPS = [1, 1.6, 2.4, 3.4, 5] as const;

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangle of the original photograph that is on screen.
 *
 * The photograph is drawn at `fit * zoom`, centred in the viewport and moved
 * by the pan. The part of it that is visible is therefore a known fraction
 * of the original, and that fraction is what gets asked for.
 */
function visibleRegion(
  view: { w: number; h: number },
  pan: { x: number; y: number },
  zoom: number,
  original: { w: number; h: number },
): Region {
  const aspect = original.w / original.h;
  const fitW = Math.min(view.w, view.h * aspect);
  const fitH = fitW / aspect;
  const dispW = fitW * zoom;
  const dispH = fitH * zoom;

  // Where the drawn photograph's top-left corner sits relative to the
  // viewport's top-left corner.
  const left = (view.w - dispW) / 2 + pan.x;
  const top = (view.h - dispH) / 2 + pan.y;

  // The viewport's window onto the drawn photograph, as a fraction of it.
  const fx = Math.max(0, -left) / dispW;
  const fy = Math.max(0, -top) / dispH;
  const fw = Math.min(1, view.w / dispW);
  const fh = Math.min(1, view.h / dispH);

  const width = Math.max(1, Math.min(original.w, fw * original.w));
  const height = Math.max(1, Math.min(original.h, fh * original.h));
  const x = Math.max(0, Math.min(original.w - width, fx * original.w));
  const y = Math.max(0, Math.min(original.h - height, fy * original.h));

  return { x, y, width, height };
}

/** Round a region to a grid, so a drag does not ask for a new file per pixel. */
function quantise(region: Region, step = 24): Region {
  const q = (v: number) => Math.round(v / step) * step;
  return {
    x: q(region.x),
    y: q(region.y),
    width: q(region.width),
    height: q(region.height),
  };
}

export function PhotoLightbox({ photos, index, onIndexChange, onClose }: PhotoLightboxProps) {
  const photo = photos[index];
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [view, setView] = useState({ w: 0, h: 0 });
  const [region, setRegion] = useState<Region | null>(null);
  const [loadedUrl, setLoadedUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [shownIndex, setShownIndex] = useState(index);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * The style the visitor has chosen.
   *
   * The style is applied by the cloud, not in the browser: choosing one
   * changes the URL the photograph is asked for, and what comes back has
   * been painted in that style. The original is never altered — asking for
   * it again simply asks for it again.
   */
  const [styleId, setStyleId] = useState('original');
  /** Whether the cloud has widened the frame with generative fill. */
  const [widened, setWidened] = useState(false);
  /** What this account can do: null until the cloud has been asked. */
  const [canPaint, setCanPaint] = useState<boolean | null>(null);
  const [canWiden, setCanWiden] = useState<boolean | null>(null);
  /** Whether the share card is on screen. */
  const [shareOpen, setShareOpen] = useState(false);
  /**
   * The name of the transformation that shapes a share card, when the
   * account has one written down in it.
   */
  const [namedCard, setNamedCard] = useState<string | undefined>(undefined);
  /** Whether the card has failed to arrive, so the inline one can stand in. */
  const [cardBroken, setCardBroken] = useState(false);
  /** What to say when the cloud cannot do what was asked of it. */
  const [widenNote, setWidenNote] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // A new photograph starts over, unzoomed.
  if (shownIndex !== index) {
    setShownIndex(index);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRegion(null);
    setFallbackSrc(null);
    setFailed(false);
    setStyleId('original');
    setWidened(false);
    setShareOpen(false);
    setCardBroken(false);
  }

  /**
   * What the account can do.
   *
   * The AI effects are add-ons. Rather than offering a button that fails,
   * the viewer asks the cloud once — the answer is cached for the session —
   * and only offers what the cloud says it can do.
   *
   * The painting styles are asked about as soon as the viewer opens: they
   * are ordinary transformations and cost nothing. Generative fill is asked
   * about only when somebody asks for a wider frame, because the cloud
   * charges for that one.
   */
  useEffect(() => {
    if (!photo) return;
    let live = true;
    void supports('art', photo.publicId).then((ok) => {
      if (live) setCanPaint(ok);
    });
    return () => {
      live = false;
    };
  }, [photo]);

  /**
   * Whether the account has a share card written down in it.
   *
   * A named transformation says how a card is shaped once, in the account,
   * rather than in every URL that asks for one. The cloud is asked once; if
   * it has no such transformation, the card is built inline as before.
   */
  useEffect(() => {
    if (!photo) return;
    let live = true;
    void supportsNamed('bengaluru_card', photo.publicId).then((ok) => {
      if (live && ok) setNamedCard('bengaluru_card');
    });
    return () => {
      live = false;
    };
  }, [photo]);

  // Measure the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const original = useMemo(
    () => ({ w: photo?.width ?? 1280, h: photo?.height ?? 960 }),
    [photo],
  );

  /** The region being asked for — none at all until the photograph is zoomed. */
  const activeRegion = zoom > 1.01 && !widened ? region : null;

  /** The style currently being asked for. */
  const style = styleById(styleId);

  /**
   * The URL of what is on screen.
   *
   * Unzoomed, that is the whole photograph. Zoomed in, it is the visible
   * rectangle of the original, delivered at the size it is displayed — so
   * the file that arrives is the one the screen can use.
   *
   * The style, when one is chosen, is a component of the same URL: the cloud
   * applies it to the photograph on the way out.
   */
  const sourceUrl = useMemo(() => {
    if (!photo) return '';
    if (widened) {
      return publicGenerated(
        photo.publicId,
        `continue the scene of ${photo.landmarkName ?? photo.title} naturally`,
        1600,
        photo.localFallback,
      );
    }
    const effect = style.effect || undefined;
    if (zoom <= 1.01 || !activeRegion) {
      return publicFull(photo.publicId, 1600, photo.localFallback, effect);
    }
    const displayed = Math.min(2400, Math.max(600, Math.round(view.w * zoom)));
    return publicRegion(
      photo.publicId,
      activeRegion,
      displayed,
      photo.localFallback,
      effect,
    );
  }, [photo, zoom, activeRegion, view.w, style.effect, widened]);

  // Ask for the region a moment after the view settles, so a drag does not
  // queue a request for every intermediate position.
  useEffect(() => {
    if (!photo || zoom <= 1.01 || view.w === 0) return;
    const timer = window.setTimeout(() => {
      setRegion(quantise(visibleRegion(view, pan, zoom, original)));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [photo, zoom, pan, view, original]);

  /**
   * The photograph on screen.
   *
   * Normally the cloud's copy; the original on this server if the cloud
   * could not deliver it.
   */
  const displayedUrl = fallbackSrc ?? sourceUrl;

  /**
   * The URL of what has arrived, in the same form as `displayedUrl`.
   *
   * The browser reports the resolved address of a loaded image, so a local
   * path has to be resolved the same way before the two can be compared —
   * otherwise the viewer would go on waiting for a photograph that has
   * already arrived.
   */
  const absoluteUrl = (u: string) => {
    try {
      return new URL(u, window.location.href).href;
    } catch {
      return u;
    }
  };

  /** The rendition on screen has not arrived yet. */
  const loading = !failed && absoluteUrl(displayedUrl) !== loadedUrl;

  /**
   * There is nothing to show at all.
   *
   * A photograph that is neither in the cloud nor on this server has no URL
   * to ask for, so the viewer says so instead of waiting for ever.
   */
  const missing = !displayedUrl;

  /**
   * The cloud could not deliver the photograph.
   *
   * The original is on this server as well, so the viewer shows that rather
   * than an empty frame — and says so, instead of pretending the photograph
   * is on its way for ever.
   */
  const onImageError = () => {
    const local = photo?.localFallback;
    if (local && absoluteUrl(displayedUrl) !== absoluteUrl(local)) {
      setFallbackSrc(local);
      setLoadedUrl('');
      return;
    }
    setFailed(true);
  };

  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_STEPS.find((s) => s > z + 0.01);
      return next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const reversed = [...ZOOM_STEPS].reverse();
      const next = reversed.find((s) => s < z - 0.01);
      return next ?? ZOOM_STEPS[0];
    });
  }, []);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /**
   * Widen the frame — if this cloud can.
   *
   * Generative fill is an add-on, and the cloud charges for it, so the
   * question is put to it the first time somebody asks for a wider frame
   * rather than on every visit. The answer is kept for the session.
   */
  const toggleWiden = useCallback(async () => {
    if (widened) {
      setWidened(false);
      setWidenNote(null);
      setFallbackSrc(null);
      setFailed(false);
      setLoadedUrl('');
      return;
    }

    let ok = canWiden;
    if (ok === null) {
      ok = await supports('generative-fill', photo?.publicId ?? '');
      setCanWiden(ok);
    }
    if (!ok) {
      setWidenNote(
        'This cloud cannot widen a frame — generative fill is not enabled on this account.',
      );
      return;
    }

    setWidenNote(null);
    setWidened(true);
    setFallbackSrc(null);
    setFailed(false);
    setLoadedUrl('');
    setZoom(1);
    setRegion(null);
  }, [widened, canWiden, photo]);

  const step = useCallback(
    (delta: number) => {
      if (photos.length < 2) return;
      onIndexChange((index + delta + photos.length) % photos.length);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step, zoomIn, zoomOut, reset]);

  // The wheel zooms towards the pointer, which is what a photograph viewer
  // is expected to do.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!photo) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      setZoom((z) => {
        const next = Math.max(1, Math.min(8, z * factor));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [photo]);

  if (!photo) return null;

  // A widened photograph comes back in a new shape, so the frame it is drawn
  // in is the shape of that new picture rather than the shape of the original.
  const aspect = widened ? 16 / 9 : original.w / original.h;
  const fitW = Math.min(view.w || 1, (view.h || 1) * aspect);
  const fitH = fitW / aspect;

  /**
   * The styles on offer.
   *
   * The ones that need an AI add-on are only shown once the cloud has said
   * it has it; the plain filters are always available.
   */
  const styles = PHOTO_STYLES.filter((s) => !s.ai || canPaint === true);

  /** The share card, built by the cloud with the caption burned into it. */
  const cardOptions = {
    title: photo.landmarkName ?? photo.title,
    credit: photo.credit,
    kicker: photo.landmarkCategory,
  };

  /**
   * The card to show.
   *
   * When the account has a card transformation written down in it, that name
   * is used; otherwise the crop and the quality are written out here. If the
   * named card fails to arrive, the inline one stands in for it rather than
   * the card simply not appearing.
   */
  const inlineCard = shareCardUrl(photo.publicId, cardOptions);
  const namedCardSrc = shareCardUrl(photo.publicId, cardOptions, 'bengaluru_card');
  const card = namedCard && !cardBroken ? namedCardSrc : inlineCard;

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1.01) return;
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (e.clientX - drag.x), y: drag.panY + (e.clientY - drag.y) });
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return createPortal(
    <div
      className="nb-fade fixed inset-0 z-[80] bg-ink-950/97 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={photo.title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* The photograph */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ cursor: zoom > 1.01 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          src={displayedUrl || undefined}
          alt={photo.title}
          draggable={false}
          onLoad={(e) => setLoadedUrl(e.currentTarget.src)}
          onError={onImageError}
          className="max-h-full max-w-full select-none object-contain shadow-2xl transition-opacity duration-200"
          style={{
            width: view.w ? fitW * zoom : undefined,
            height: view.w ? fitH * zoom : undefined,
            maxWidth: 'none',
            maxHeight: 'none',
            opacity: loading ? 0.55 : 1,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        />

        {/* Something to look at while the photograph is on its way, and
            something honest to read if it never arrives. */}
        {(loading || failed || missing) && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {failed || missing ? (
              <div className="max-w-sm px-6 text-center">
                <p className="text-[13px] text-mist-200">This photograph could not be loaded.</p>
                <p className="mt-1 text-[11px] text-mist-400">
                  The cloud could not deliver it, and the copy on this server did not load either.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false);
                    setFallbackSrc(null);
                    setLoadedUrl('');
                  }}
                  className="nb-btn nb-btn-ghost pointer-events-auto mt-4"
                >
                  Try again
                </button>
              </div>
            ) : (
              <span className="nb-chip">Loading the photograph…</span>
            )}
          </div>
        )}
      </div>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="nb-icon-btn absolute right-5 top-5 z-10"
        aria-label="Close the photograph"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>

      {/* Previous */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={() => step(-1)}
          className="nb-icon-btn absolute left-5 top-1/2 z-10 -translate-y-1/2"
          aria-label="Previous photograph"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Next */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={() => step(1)}
          className="nb-icon-btn absolute right-5 top-1/2 z-10 -translate-y-1/2"
          aria-label="Next photograph"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Zoom controls, kept at the top so they never sit on the caption. */}
      <div className="absolute left-1/2 top-5 z-10 flex -translate-x-1/2 items-center gap-1">
        <button type="button" onClick={zoomOut} className="nb-icon-btn" aria-label="Zoom out" disabled={zoom <= 1.01}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className="min-w-[4.2rem] text-center font-mono text-[11px] tabular-nums text-mist-300">
          {zoom <= 1.01 ? 'fit' : `${zoom.toFixed(1)}×`}
        </span>
        <button type="button" onClick={zoomIn} className="nb-icon-btn" aria-label="Zoom in">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        {zoom > 1.01 && (
          <button type="button" onClick={reset} className="nb-icon-btn" aria-label="Fit the photograph">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Share card, and the cloud's own way of widening a frame. */}
      <div className="absolute left-5 top-5 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShareOpen((s) => !s)}
          className="nb-btn nb-btn-ghost h-[38px] px-3 text-[11px]"
          aria-expanded={shareOpen}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M12 16V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Share card
        </button>
      </div>

      {shareOpen && card && (
        <div className="absolute left-5 top-16 z-10 w-[min(22rem,80vw)]">
          <div className="overflow-hidden rounded-sm border border-white/12 bg-ink-900/90 shadow-2xl backdrop-blur">
            <img
              src={card}
              alt={`${photo.landmarkName ?? photo.title} — share card`}
              className="block w-full"
              onError={() => {
                // A named card that will not arrive falls back to the inline
                // one; an inline card that will not arrive is closed.
                if (namedCard && !cardBroken) setCardBroken(true);
                else setShareOpen(false);
              }}
            />
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-mist-400">
            The caption and the photographer&rsquo;s credit are written into the picture by
            Cloudinary, as a text overlay — the card is delivered, not composed here.
          </p>
          <a
            href={card}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-block text-[10.5px] text-saffron underline decoration-saffron/40 underline-offset-2"
          >
            Open the card on its own
          </a>
        </div>
      )}

      {/* Caption and credit */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950/95 to-transparent px-6 pb-4 pt-14">
        {/* The styles, and the cloud's way of widening the frame. */}
        <div className="mx-auto mb-3 flex max-w-4xl items-center gap-1.5 overflow-x-auto pb-1 pointer-events-auto">
          {styles.map((s) => {
            const active = styleId === s.id && !widened;
            return (
              <button
                key={s.id}
                type="button"
                title={s.note}
                onClick={() => {
                  setStyleId(s.id);
                  setWidened(false);
                  setFallbackSrc(null);
                  setFailed(false);
                  setLoadedUrl('');
                }}
                className={`shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors ${
                  active
                    ? 'border-saffron/70 bg-saffron/15 text-saffron'
                    : 'border-white/12 text-mist-300 hover:border-white/30 hover:text-mist-100'
                }`}
              >
                {s.label}
              </button>
            );
          })}
          {canWiden !== false && (
            <button
              type="button"
              title="Cloudinary invents the rest of the frame, in the manner of the photograph"
              onClick={() => void toggleWiden()}
              className={`shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors ${
                widened
                  ? 'border-saffron/70 bg-saffron/15 text-saffron'
                  : 'border-white/12 text-mist-300 hover:border-white/30 hover:text-mist-100'
              }`}
            >
              {widened ? 'Original frame' : 'Widen the frame'}
            </button>
          )}
        </div>

        {widenNote && (
          <p className="mx-auto mb-2 max-w-4xl text-center text-[10.5px] text-mist-400">
            {widenNote}
          </p>
        )}

        <div className="mx-auto flex max-w-4xl flex-col items-center gap-1 text-center">
          <p className="text-[13px] font-medium text-mist-100">{photo.title}</p>
          <p className="max-w-2xl text-[11px] leading-relaxed text-mist-400">{photo.credit}</p>
          {photos.length > 1 && (
            <p className="mt-1 font-mono text-[10px] tabular-nums text-mist-500">
              {index + 1} / {photos.length}
            </p>
          )}
          {zoom > 1.01 && activeRegion && (
            <p className="mt-1 font-mono text-[10px] tabular-nums text-saffron/70">
              {Math.round(activeRegion.width)}×{Math.round(activeRegion.height)} of {original.w}×{original.h}
            </p>
          )}
          {widened && (
            <p className="mt-1 text-[10.5px] text-saffron/70">
              The cloud painted the rest of the frame.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
