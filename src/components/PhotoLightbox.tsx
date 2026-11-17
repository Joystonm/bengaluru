import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicFull, publicRegion } from '../cloudinary/imageDelivery';

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
  /** The Commons title, for the caption. */
  title: string;
  /** The credit line, shown under the photograph. */
  credit: string;
  /** The size of the original photograph, in pixels. */
  width: number | null;
  height: number | null;
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
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // A new photograph starts over, unzoomed.
  if (shownIndex !== index) {
    setShownIndex(index);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRegion(null);
  }

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
  const activeRegion = zoom > 1.01 ? region : null;

  /**
   * The URL of what is on screen.
   *
   * Unzoomed, that is the whole photograph. Zoomed in, it is the visible
   * rectangle of the original, delivered at the size it is displayed — so
   * the file that arrives is the one the screen can use.
   */
  const sourceUrl = useMemo(() => {
    if (!photo) return '';
    if (zoom <= 1.01 || !activeRegion) {
      return publicFull(photo.publicId, 1600);
    }
    const displayed = Math.min(2400, Math.max(600, Math.round(view.w * zoom)));
    return publicRegion(photo.publicId, activeRegion, displayed);
  }, [photo, zoom, activeRegion, view.w]);

  // Ask for the region a moment after the view settles, so a drag does not
  // queue a request for every intermediate position.
  useEffect(() => {
    if (!photo || zoom <= 1.01 || view.w === 0) return;
    const timer = window.setTimeout(() => {
      setRegion(quantise(visibleRegion(view, pan, zoom, original)));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [photo, zoom, pan, view, original]);

  /** The rendition on screen has not arrived yet. */
  const loading = sourceUrl !== loadedUrl;

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

  const aspect = original.w / original.h;
  const fitW = Math.min(view.w || 1, (view.h || 1) * aspect);
  const fitH = fitW / aspect;

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
          src={sourceUrl}
          alt={photo.title}
          draggable={false}
          onLoad={(e) => setLoadedUrl(e.currentTarget.src)}
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

      {/* Zoom controls */}
      <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1">
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

      {/* Caption and credit */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink-950/95 to-transparent px-6 pb-4 pt-14">
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
