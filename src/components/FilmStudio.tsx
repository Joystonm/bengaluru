import { useMemo, useState } from 'react';
import { useFilm } from '../state/filmStore';
import {
  videoHlsFor,
  videoPosterFor,
  videoPreviewFor,
  videoUrlFor,
} from '../cloudinary/videoDelivery';

/**
 * The film studio.
 *
 * Two states: the recorder running, and the film that came of it. When the
 * film reached the cloud it is delivered from there — with the codec the
 * browser asked for, a poster frame cut out of the film by the cloud, the
 * same film as an adaptive-streaming manifest, and the film taken apart by
 * the cloud into an animation.
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

  /**
   * The cloud's copy of the film would not play.
   *
   * The copy recorded on this machine takes its place, because a film that
   * was taken should be watchable even when the cloud's delivery of it
   * fails — and the panel says so, rather than leaving a black rectangle.
   */
  const [cloudBroken, setCloudBroken] = useState(false);
  /** The animation the cloud made of the film would not load. */
  const [previewBroken, setPreviewBroken] = useState(false);
  /** The film the two of them belong to. */
  const [filmFor, setFilmFor] = useState(publicId);

  // A new film gets a new delivery, so whatever went wrong with the last
  // one says nothing about this one. The reset happens while rendering,
  // so that there is never a moment in which the last film's failure is
  // showing against the new one.
  if (filmFor !== publicId) {
    setFilmFor(publicId);
    setCloudBroken(false);
    setPreviewBroken(false);
  }

  const delivery = useMemo(() => {
    if (!publicId) return null;
    return {
      video: videoUrlFor(publicId, { quality: 'auto', format: 'auto' }),
      poster: videoPosterFor(publicId, 1280, 1),
      preview: videoPreviewFor(publicId, 240),
      hls: videoHlsFor(publicId),
    };
  }, [publicId]);

  /** The film on screen: the cloud's copy, or the one on this machine. */
  const source = cloudBroken
    ? (film?.localUrl ?? undefined)
    : (delivery?.video ?? film?.localUrl ?? undefined);

  /** The poster belongs to the cloud's copy, so it goes when that does. */
  const poster = cloudBroken ? undefined : delivery?.poster;

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
            {source ? (
              <video
                key={source}
                src={source}
                poster={poster}
                controls
                autoPlay
                loop
                muted
                playsInline
                className="block w-full bg-ink-950"
                onError={() => setCloudBroken(true)}
              />
            ) : (
              <div className="grid aspect-video place-items-center px-5 text-center">
                <p className="text-[11px] leading-relaxed text-mist-400">
                  The film could not be played.
                </p>
              </div>
            )}

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

              {/*
                The cloud's copy did not play.

                Said plainly, because the panel below goes on showing the
                cloud's addresses — and a reader who took those at face
                value would be told the film was being served when it was
                not.
              */}
              {cloudBroken && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-mist-400">
                  {film.localUrl
                    ? 'The cloud’s copy of the film would not play, so the film on screen is the one recorded on this machine.'
                    : 'The cloud’s copy of the film would not play, and there is no copy on this machine to fall back on.'}
                </p>
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
                    <>
                      <p className="mt-1.5 break-all font-mono text-[9.5px] leading-relaxed text-mist-500/70">
                        HLS: {delivery.hls}
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-mist-500">
                        The same film as an adaptive-streaming manifest — a ladder of
                        renditions the browser climbs or comes down as the connection
                        changes.
                      </p>
                    </>
                  )}
                  {delivery.preview && !previewBroken && (
                    <div className="mt-3 flex items-start gap-3">
                      <img
                        src={delivery.preview}
                        alt="The film, played back by Cloudinary as an animation"
                        className="h-12 w-auto shrink-0 rounded-sm border border-white/10 opacity-80"
                        onError={() => setPreviewBroken(true)}
                      />
                      <p className="text-[10px] leading-relaxed text-mist-500">
                        The film as an animation — the cloud took it apart into frames and
                        put it back together, and the whole thing is one picture.
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
