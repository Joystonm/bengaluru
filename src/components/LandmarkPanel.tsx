import { useMemo, useState } from 'react';
import type { Landmark, LandmarkPhoto } from '../data/landmarks';
import { photoCredit } from '../data/landmarks';
import { useApp } from '../state/store';
import {
  landmarkHeroResponsive,
  landmarkOriginal,
  landmarkPublicId,
  landmarkThumbResponsive,
  photoFallback,
} from '../cloudinary/imageDelivery';
import { contributionsFor } from '../cloudinary/contributions';
import { PhotoLightbox } from './PhotoLightbox';
import type { LightboxPhoto } from './PhotoLightbox';
import { ContributePhoto } from './ContributePhoto';
import { focusLandmark } from '../three/focus';
import { hasModelFor } from '../three/modelRegistry';

/**
 * The editorial panel for a landmark.
 *
 * Real photographs delivered through Cloudinary, real history and facts, the
 * real coordinate, and a route into the detailed 3D model where one exists.
 */
export function LandmarkPanel({ landmark }: { landmark: Landmark }) {
  const select = useApp((s) => s.select);
  const setInspect = useApp((s) => s.setInspect);
  const setMode = useApp((s) => s.setMode);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [contributed, setContributed] = useState<LandmarkPhoto[]>([]);
  const [loadedFor, setLoadedFor] = useState(landmark.id);

  // Photographs this browser has offered for this landmark. The list is read
  // from the browser's own storage, which is an external system: when the
  // landmark changes, it is read again rather than carried over. The same
  // change starts the panel back at the first photograph.
  if (loadedFor !== landmark.id) {
    setLoadedFor(landmark.id);
    setPhotoIndex(0);
    setContributed(
      contributionsFor(landmark.id).map((c) => ({
        src: c.publicId,
        publicId: c.publicId,
        commonsUrl: null,
        commonsTitle: c.title,
        descriptionUrl: null,
        author: c.author,
        credit: 'Offered by a visitor',
        license: c.license,
        licenseUrl: null,
        attributionRequired: true,
        angle: 'contributed',
        width: c.width,
        height: c.height,
      })),
    );
  }

  const photos = useMemo(
    () => [...landmark.photos, ...contributed],
    [landmark.photos, contributed],
  );
  const current = photos[photoIndex] ?? null;

  const hero = useMemo(
    () => (current ? landmarkHeroResponsive(landmark.id, current.src, current.publicId) : null),
    [landmark.id, current],
  );

  /** The photographs, in the shape the viewer wants them. */
  const lightboxPhotos = useMemo<LightboxPhoto[]>(
    () =>
      photos.map((p) => ({
        publicId: p.publicId ?? landmarkPublicId(landmark.id, p.src),
        src: p.src,
        // The original is on this server too, and the viewer falls back to
        // it if the cloud cannot deliver the photograph.
        localFallback: p.publicId ? undefined : landmarkOriginal(landmark.id, p.src),
        title: p.commonsTitle?.replace(/^File:/, '').replace(/\.\w+$/, '') ?? landmark.name,
        credit: photoCredit(p),
        width: p.width,
        height: p.height,
      })),
    [photos, landmark.id, landmark.name],
  );

  const distanceLabel = useMemo(() => {
    if (landmark.latitude === null || landmark.longitude === null) return null;
    return `${landmark.latitude.toFixed(5)}° N, ${landmark.longitude.toFixed(5)}° E`;
  }, [landmark]);

  const focus = () => {
    if (landmark.x === null || landmark.y === null) return;
    focusLandmark(landmark);
  };

  const inspect = () => {
    setInspect(landmark.id);
    setMode('inspect');
  };

  return (
    <aside
      className="nb-panel nb-panel-solid nb-scroll fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto rounded-none border-y-0 border-r-0 sm:max-w-[26rem]"
      style={{ animation: 'nb-fade-up 0.4s cubic-bezier(0.22,1,0.36,1) both' }}
      aria-label={`${landmark.name} details`}
    >
      {/* Hero photograph */}
      <div className="group relative aspect-[3/2] w-full shrink-0 overflow-hidden bg-ink-800">
        {current && hero ? (
          <>
            {/* A blurred rendition of the photograph sits underneath it, so the
                panel never shows an empty grey box while it arrives. */}
            {hero.lqip && (
              <div
                key={current.src}
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${hero.lqip})` }}
                aria-hidden="true"
              />
            )}
            <img
              key={current.src}
              src={hero.src}
              srcSet={hero.srcSet || undefined}
              sizes={hero.sizes || undefined}
              alt={current.commonsTitle?.replace(/^File:/, '') ?? landmark.name}
              className="relative h-full w-full object-cover transition-opacity duration-500"
              style={{ opacity: 0 }}
              loading="lazy"
              decoding="async"
              onLoad={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              onError={current.publicId ? undefined : photoFallback(landmark.id, current.src)}
            />
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="nb-hover-reveal absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-sm bg-ink-950/70 px-2.5 py-1.5 text-[11px] text-mist-200 backdrop-blur transition-opacity hover:text-mist-100 focus-visible:opacity-100"
              aria-label={`Open ${current.commonsTitle?.replace(/^File:/, '') ?? landmark.name} full screen`}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <path
                  d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Enlarge
            </button>
          </>
        ) : (
          <div className="grid h-full w-full place-items-center px-8 text-center text-mist-500">
            <span className="nb-label">No photograph available</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-transparent" />

        <button
          type="button"
          onClick={() => select(null)}
          className="nb-icon-btn absolute right-4 top-4"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {photos.length > 1 && (
          <div className="absolute bottom-3 left-4 right-4 flex items-center gap-1.5">
            {photos.map((p, i) => (
              <button
                key={p.src}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={`Photo ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === photoIndex ? 'w-6 bg-saffron' : 'w-1.5 bg-white/35 hover:bg-white/60'
                }`}
              />
            ))}
            <span className="ml-auto font-mono text-[10px] tabular-nums text-mist-300">
              {photoIndex + 1}/{photos.length}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-6 px-6 pb-8 pt-5">
        <header>
          <span className="nb-chip">{landmark.category}</span>
          {landmark.subcategory && (
            <p className="mt-3 text-[11.5px] uppercase tracking-[0.13em] text-mist-400">
              {landmark.subcategory}
            </p>
          )}
          <h2 className="nb-display mt-1.5 text-[2rem] leading-tight text-mist-100">
            {landmark.name}
          </h2>
          {landmark.kannadaName && (
            <p className="nb-display mt-1 text-lg text-saffron/85">{landmark.kannadaName}</p>
          )}
        </header>

        {landmark.description && (
          <p className="text-[13.5px] leading-relaxed text-mist-200">{landmark.description}</p>
        )}

        {landmark.photoNote && (
          <p className="border-l-2 border-saffron/45 pl-3 text-[12.5px] leading-relaxed text-mist-400">
            {landmark.photoNote}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="nb-btn nb-btn-ghost" onClick={focus}>
            Show me
          </button>
          {hasModelFor(landmark.id) && (
            <button type="button" className="nb-btn nb-btn-ghost" onClick={inspect}>
              Inspect the 3D model
            </button>
          )}
        </div>

        {landmark.history && (
          <section>
            <h3 className="nb-label mb-2">History</h3>
            <p className="text-[13px] leading-relaxed text-mist-300">{landmark.history}</p>
          </section>
        )}

        {landmark.facts.length > 0 && (
          <section>
            <h3 className="nb-label mb-2.5">Facts</h3>
            <ul className="space-y-2">
              {landmark.facts.map((f, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-mist-200">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-saffron/80" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {landmark.architecture && (
          <section>
            <h3 className="nb-label mb-2.5">Architecture</h3>
            <dl className="space-y-2 text-[12.5px]">
              {landmark.architecture.style && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-mist-400">Style</dt>
                  <dd className="flex-1 text-mist-200">{landmark.architecture.style}</dd>
                </div>
              )}
              {landmark.architecture.yearBuilt && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-mist-400">Built</dt>
                  <dd className="flex-1 text-mist-200">{landmark.architecture.yearBuilt}</dd>
                </div>
              )}
              {landmark.architecture.architect && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-mist-400">Architect</dt>
                  <dd className="flex-1 text-mist-200">{landmark.architecture.architect}</dd>
                </div>
              )}
              {landmark.architecture.materials && (
                <div className="flex gap-3">
                  <dt className="w-24 shrink-0 text-mist-400">Material</dt>
                  <dd className="flex-1 text-mist-200">{landmark.architecture.materials}</dd>
                </div>
              )}
            </dl>
            {landmark.architecture.keyFeatures?.length ? (
              <ul className="mt-3 space-y-1.5">
                {landmark.architecture.keyFeatures.map((k, i) => (
                  <li key={i} className="flex gap-2.5 text-[12.5px] text-mist-300">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-mist-500" />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}

        {distanceLabel && (
          <section>
            <h3 className="nb-label mb-2">Location</h3>
            <p className="font-mono text-[12px] text-mist-200">{distanceLabel}</p>
            {landmark.elevationM !== null && (
              <p className="mt-1 font-mono text-[11.5px] text-mist-400">
                Elevation {Math.round(landmark.elevationM)} m
              </p>
            )}
          </section>
        )}

        {photos.length > 0 && (
          <section>
            <h3 className="nb-label mb-2.5">Photographs</h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((p, i) => {
                const thumb = landmarkThumbResponsive(landmark.id, p.src, '92px', p.publicId);
                return (
                  <button
                    key={p.publicId ?? p.src}
                    type="button"
                    onClick={() => setPhotoIndex(i)}
                    className="shrink-0 overflow-hidden rounded-sm border border-white/10 transition-opacity hover:opacity-100"
                    style={{ opacity: i === photoIndex ? 1 : 0.55 }}
                    aria-label={p.commonsTitle ?? p.src}
                  >
                    <img
                      src={thumb.src}
                      srcSet={thumb.srcSet || undefined}
                      sizes={thumb.sizes || undefined}
                      onError={p.publicId ? undefined : photoFallback(landmark.id, p.src)}
                      alt={p.commonsTitle?.replace(/^File:/, '') ?? ''}
                      width={92}
                      height={92}
                      loading="lazy"
                      decoding="async"
                      className="h-[92px] w-[92px] object-cover"
                    />
                  </button>
                );
              })}
            </div>
            {current && (
              <p className="mt-1 text-[10.5px] leading-relaxed text-mist-400">
                {photoCredit(current)}
              </p>
            )}
            <ContributePhoto
              slug={landmark.id}
              onUploaded={(photo) => setContributed((c) => [...c, photo])}
            />
          </section>
        )}

        {landmark.sources.length > 0 && (
          <section>
            <h3 className="nb-label mb-2.5">Sources</h3>
            <ul className="space-y-1.5">
              {landmark.sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[12px] text-mist-300 underline decoration-white/20 underline-offset-2 transition-colors hover:text-saffron"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {lightboxOpen && (
        <PhotoLightbox
          photos={lightboxPhotos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </aside>
  );
}
