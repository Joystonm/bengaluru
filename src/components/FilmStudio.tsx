import { useMemo } from 'react';
import { useFilm } from '../state/filmStore';
import {
  videoHlsFor,
  videoPosterFor,
  videoSpriteFor,
  videoUrlFor,
} from '../cloudinary/videoDelivery';

/**
 * The film studio.
 *
 * Two states: the recorder running, and the film that came of it. When the
 * film reached the cloud it is delivered from there — with the codec the
 * browser asked for, a poster frame cut out of the film by the cloud, and
 * the whole film laid out as a strip of frames for scrubbing.
 *
 * The delivery URL is shown on screen, because a media pipeline is worth
 * more when you can see what it is doing.
 */

/** How long a film may run, in seconds. */
const MAX_SECONDS = 30;

export function FilmStudio() {
  const status = useFilm((s) => s.status);
  const elapsed = useFilm((s) => s.elapsed);
  const error = useFilm((s) => s.error);
  const note = useFilm((s) => s.note);
  const film = useFilm((s) => s.film);
  const begin = useFilm((s) => s.begin);
  const stop = useFilm((s) => s.stop);
  const reset = useFilm((s) => s.reset);

  /** Where the film is being delivered from. */
  const publicId = film?.publicId ?? null;
  const delivery = useMemo(() => {
    if (!publicId) return null;
    return {
      video: videoUrlFor(publicId, { quality: 'auto', format: 'auto' }),
      poster: videoPosterFor(publicId, 1280, 1),
      sprite: videoSpriteFor(publicId, 320),
      hls: videoHlsFor(publicId),
    };
  }, [publicId]);

  if (status === 'idle') return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center p-6">
      <div className="pointer-events-auto w-full max-w-2xl">
        {status === 'recording' && (
          <div className="nb-panel nb-panel-solid rounded-sm border border-white/10 p-6 text-center">
            <div className="flex items-center justify-center gap-2.5">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-terracotta" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mist-300">
                Recording the city
              </span>
            </div>
            <p className="mt-4 font-mono text-4xl tabular-nums text-mist-100">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
              {String(elapsed % 60).padStart(2, '0')}
            </p>
            <div className="mx-auto mt-4 h-[3px] w-full max-w-sm overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-saffron transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%` }}
              />
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-mist-400">
              The camera turns slowly on its own. The film is made from the frames the city
              is already drawing, and it stops by itself after thirty seconds.
            </p>
            <button type="button" onClick={stop} className="nb-btn nb-btn-ghost mt-5">
              Stop the film
            </button>
          </div>
        )}

        {status === 'processing' && (
          <div className="nb-panel nb-panel-solid rounded-sm border border-white/10 p-6 text-center">
            <span className="nb-chip">Sending the film to the cloud</span>
            <p className="mt-4 text-[12px] leading-relaxed text-mist-400">
              It is being uploaded straight to Cloudinary, with the unsigned preset — the
              same way a visitor&rsquo;s photograph is.
            </p>
          </div>
        )}

        {status === 'failed' && (
          <div className="nb-panel nb-panel-solid rounded-sm border border-white/10 p-6 text-center">
            <span className="nb-chip">No film</span>
            <p className="mt-4 text-[12.5px] leading-relaxed text-mist-300">{error}</p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" onClick={reset} className="nb-btn nb-btn-ghost">
                Close
              </button>
              <button type="button" onClick={begin} className="nb-btn nb-btn-ghost">
                Try again
              </button>
            </div>
          </div>
        )}

        {status === 'ready' && film && (
          <div className="nb-panel nb-panel-solid overflow-hidden rounded-sm border border-white/10">
            <video
              key={delivery?.video ?? film.localUrl ?? ''}
              src={delivery?.video ?? film.localUrl ?? undefined}
              poster={delivery?.poster}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="block w-full bg-ink-950"
            />

            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="nb-chip">
                  {film.uploaded ? 'Delivered by Cloudinary' : 'Held on this machine'}
                </span>
                {film.duration !== null && (
                  <span className="font-mono text-[10.5px] tabular-nums text-mist-400">
                    {film.duration.toFixed(1)} s · {(film.bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
              </div>

              {note && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-mist-400">{note}</p>
              )}

              {delivery && (
                <>
                  <p className="mt-3 text-[11.5px] leading-relaxed text-mist-400">
                    The film is served from the cloud in whatever form the browser asked
                    for, and the poster above was cut out of the film by the cloud rather
                    than stored beside it.
                  </p>
                  <p className="mt-2 break-all rounded-sm bg-ink-950/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-mist-500">
                    {delivery.video}
                  </p>
                  {delivery.hls && (
                    <p className="mt-1.5 break-all font-mono text-[9.5px] leading-relaxed text-mist-500/70">
                      HLS: {delivery.hls}
                    </p>
                  )}
                  {delivery.sprite && (
                    <div className="mt-3">
                      <img
                        src={delivery.sprite}
                        alt="The film, laid out by Cloudinary as a strip of frames"
                        className="h-10 w-full rounded-sm object-cover opacity-70"
                      />
                      <p className="mt-1 text-[10px] text-mist-500">
                        The film as a strip of frames — one image, cut out of the film by
                        the cloud.
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="mt-4 flex gap-2">
                <button type="button" onClick={begin} className="nb-btn nb-btn-ghost">
                  Film it again
                </button>
                <button type="button" onClick={reset} className="nb-btn nb-btn-ghost">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
