import { useMemo, useState } from 'react';
import { usePostcard } from '../state/postcardStore';
import { useApp } from '../state/store';
import { postcardCardUrl } from '../cloudinary/postcard';
import { shareCardUrl } from '../cloudinary/shareCard';
import { uploadsEnabled } from '../cloudinary/config';

/**
 * The postcard panel.
 *
 * A postcard is the visitor's own picture of the city: the frame they were
 * looking at when they pressed the button, sent to the cloud and given back
 * with a caption written onto it. The panel is where that picture is shown,
 * and where the caption can be changed.
 *
 * The changing of the caption is the interesting part. The caption is not
 * drawn into the picture in the browser — it is a text overlay in the
 * delivery URL, so the cloud writes the words onto the picture as it
 * delivers it. Rewriting the caption therefore rewrites the address of the
 * card and nothing else: the picture in the cloud is not touched, and
 * nothing is uploaded a second time.
 *
 * It sits on the left of the screen, because the landmark's own panel is
 * fixed on the right, and the two are often open at once — a visitor
 * reading about a landmark and sending a postcard of it should not have to
 * choose which one to look at.
 */

/** The caption a postcard carries when the visitor has not written one. */
const DEFAULT_CAPTION = 'Namma Bengaluru';

export function PostcardPanel() {
  const open = usePostcard((s) => s.open);
  const status = usePostcard((s) => s.status);
  const caption = usePostcard((s) => s.caption);
  const message = usePostcard((s) => s.message);
  const failure = usePostcard((s) => s.failure);
  const publicId = usePostcard((s) => s.publicId);
  const localUrl = usePostcard((s) => s.localUrl);
  const autoTags = usePostcard((s) => s.autoTags);
  const setCaption = usePostcard((s) => s.setCaption);
  const close = usePostcard((s) => s.close);

  const landmarks = useApp((s) => s.landmarks);
  const selectedId = useApp((s) => s.selectedId);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const weather = useApp((s) => s.weather);
  const festival = useApp((s) => s.festival);

  /** Whether the cloud's card could not be fetched. */
  const [cardBroken, setCardBroken] = useState(false);
  /** Whether the picture on screen could not be shown at all. */
  const [pictureFailed, setPictureFailed] = useState(false);
  /** Whether the link has just been copied. */
  const [copied, setCopied] = useState(false);
  /** The postcard the states above belong to. */
  const [cardFor, setCardFor] = useState(publicId);

  // A new postcard gets a new card, so whatever went wrong with the last
  // one says nothing about this one. The reset happens while rendering
  // rather than in an effect, so that there is never a moment in which the
  // last postcard's failure is showing against the new picture.
  if (cardFor !== publicId) {
    setCardFor(publicId);
    setCardBroken(false);
    setPictureFailed(false);
    setCopied(false);
  }

  /** The landmark the visitor was looking at, when there was one. */
  const landmark = useMemo(
    () => landmarks.find((l) => l.id === selectedId) ?? null,
    [landmarks, selectedId],
  );

  /** The words written onto the card, large. */
  const title = caption.trim() || DEFAULT_CAPTION;

  /** The small line under them: when the picture was taken. */
  const credit = useMemo(() => {
    const bits: string[] = [timeOfDay];
    if (weather !== 'clear') bits.push(weather);
    if (festival !== 'none') bits.push(festival);
    bits.push("a visitor's postcard");
    return bits.join(' · ');
  }, [timeOfDay, weather, festival]);

  /** The line above them: where the picture was taken. */
  const kicker = landmark?.name ?? 'Namma Bengaluru';

  /** The three lines the card is written with. */
  const cardOptions = useMemo(
    () => ({ title, credit, kicker }),
    [title, credit, kicker],
  );

  /** The card, with the crop and the quality named in the account. */
  const namedCard = publicId ? postcardCardUrl(publicId, cardOptions) : '';
  /** The same card, with the crop written out instead of named. */
  const inlineCard = publicId ? shareCardUrl(publicId, cardOptions) : '';

  /**
   * The card that is on screen.
   *
   * A named transformation the account does not have answers with an error
   * rather than with a picture, so the inline card stands in for it — the
   * same arrangement the photograph viewer makes.
   */
  const card = cardBroken ? inlineCard : namedCard;

  /**
   * The picture on screen: the cloud's card, or the frame as it was taken,
   * when the cloud would not take it.
   */
  const shown = publicId ? card : (localUrl ?? '');

  const busy = status === 'capturing' || status === 'uploading';

  /**
   * What to call the failure.
   *
   * "No postcard" is a description of the visitor's situation and not of the
   * reason, and the reason is the part somebody can do something about. A
   * picture that was never taken wants the browser; a build that was never
   * given a preset wants a setting; a cloud that turned the picture away
   * wants the cloud's own words; a request that never arrived wants the
   * network.
   */
  const failureChip =
    failure === 'capture'
      ? 'Not taken — the browser would not give up the picture'
      : failure === 'not-configured'
        ? 'Not sent — this build is not set up'
        : failure === 'network'
          ? 'Not sent — the cloud could not be reached'
          : 'Not sent — the cloud turned it away';

  /**
   * The picture could not be fetched.
   *
   * The cloud's card is tried first and the inline card second; after that
   * there is nothing left to try, and the frame from this machine is better
   * than an empty rectangle.
   */
  const onPictureError = () => {
    if (publicId && !cardBroken) {
      setCardBroken(true);
      return;
    }
    setPictureFailed(true);
  };

  /** Put the card's address on the clipboard. */
  const copy = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // A browser that will not hand over the clipboard still shows the
      // address underneath, where it can be selected by hand.
      setCopied(false);
    }
  };

  /** Take the card away as a file. */
  const download = async () => {
    if (!shown) return;
    try {
      const res = await fetch(shown);
      if (!res.ok) throw new Error('the cloud did not answer');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'namma-bengaluru-postcard.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // The object URL is released a moment later, so that the browser has
      // finished reading the file before it goes.
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      // A card that will not be fetched is still worth opening.
      window.open(shown, '_blank', 'noopener,noreferrer');
    }
  };

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        role="dialog"
        aria-label="Your postcard"
        className="nb-panel nb-panel-solid nb-scroll pointer-events-auto absolute left-0 top-0 flex h-full w-full flex-col overflow-y-auto rounded-none border-y-0 border-l-0 sm:w-[24rem]"
      >
        {/* The heading */}
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
          <div className="min-w-0">
            <span className="nb-label">Your postcard</span>
            <h2 className="nb-display mt-1 text-[20px] leading-tight text-mist-100">
              A picture of the city, with your words on it
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="nb-icon-btn shrink-0"
            aria-label="Close the postcard"
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
        </div>

        <div className="flex-1 px-4 pb-5 sm:px-5">
          {/* What a postcard is */}
          <p className="text-[11.5px] leading-relaxed text-mist-400">
            A postcard is the frame you were looking at when you pressed the button. It
            goes to Cloudinary, and the words are written onto it there — by the cloud,
            not by this page.
          </p>

          {/*
            Said before the visitor tries, rather than after they have.

            A build without an upload preset still takes the picture; it just
            cannot send it. Saying so up front turns a failure into a
            sentence of explanation, and it saves the visitor the trouble of
            pressing the button to find out.
          */}
          {!uploadsEnabled && (
            <p className="mt-3 rounded-sm border border-saffron/25 bg-saffron/10 px-2.5 py-2 text-[10.5px] leading-relaxed text-mist-300">
              This build has no Cloudinary upload preset, so the postcard is taken and
              kept on this machine but cannot be sent to the cloud.
            </p>
          )}

          {/* What is happening */}
          {status === 'capturing' && (
            <div className="mt-4 flex items-center gap-2.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-terracotta" />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-mist-300">
                Taking the picture…
              </span>
            </div>
          )}

          {status === 'uploading' && (
            <div className="mt-4 flex items-center gap-2.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-saffron" />
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-mist-300">
                Sending it to the cloud…
              </span>
            </div>
          )}

          {/* The card */}
          <div className="mt-4 overflow-hidden rounded-sm border border-white/10 bg-ink-950">
            {shown && !pictureFailed ? (
              <img
                src={shown}
                alt={
                  publicId
                    ? 'The postcard, with the caption written onto it by Cloudinary'
                    : 'The picture of the city, as it was taken'
                }
                className="block w-full"
                onError={onPictureError}
              />
            ) : (
              <div className="grid aspect-[1200/630] place-items-center px-5 text-center">
                <p className="text-[11px] leading-relaxed text-mist-400">
                  {pictureFailed
                    ? 'The picture could not be shown.'
                    : 'The picture is being taken.'}
                </p>
              </div>
            )}
          </div>

          {/* The caption */}
          <div className="mt-4">
            <label htmlFor="postcard-caption" className="nb-label">
              The caption
            </label>
            <input
              id="postcard-caption"
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={DEFAULT_CAPTION}
              className="mt-1.5 w-full rounded-sm border border-white/12 bg-ink-950/60 px-2.5 py-2 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-500 focus:border-saffron/50"
            />
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist-500">
              Changing the caption rewrites the card&rsquo;s address — nothing is uploaded
              again. The words are a text overlay the cloud draws on the picture as it
              delivers it, which is why the picture in the cloud never has to change.
            </p>
          </div>

          {/*
            What the cloud made of the picture.

            These are the cloud's own words for it — it read the frame and
            named what it found — and they are attached to the asset rather
            than written onto it, so a postcard can be found in the library
            by what it shows and not only by what it was called.
          */}
          {autoTags.length > 0 && (
            <div className="mt-4">
              <p className="nb-label">What the cloud saw</p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {autoTags.map((tag) => (
                  <span key={tag} className="nb-chip">
                    {tag}
                  </span>
                ))}
              </p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist-500">
                The cloud read the picture and named what was in it. The names are on the
                asset itself, so the postcard can be found in the library by what it shows.
              </p>
            </div>
          )}

          {/* What went wrong */}
          {status === 'failed' && message && (
            <div className="mt-4 rounded-sm border border-white/10 bg-white/3 p-3">
              <span className="nb-chip">{failureChip}</span>
              <p className="mt-2 text-[11.5px] leading-relaxed text-mist-300">{message}</p>
              {failure === 'not-configured' && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-mist-400">
                  The name of the preset <em>is</em> the permission — it is public by
                  design, and no API secret is needed here and none is shipped. Once it
                  is set, restart the dev server or rebuild, and take the postcard again.
                </p>
              )}
              {localUrl && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-mist-400">
                  The picture itself was taken, and it is still on this machine — it is
                  shown above, and it can still be downloaded.
                </p>
              )}
            </div>
          )}

          {/* The delivery URL */}
          {card && (
            <>
              <p className="nb-label mt-4">The delivery URL</p>
              <p className="mt-1.5 select-all break-all rounded-sm bg-ink-950/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-mist-500">
                {card}
              </p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist-500">
                The card is delivered by Cloudinary, with the caption and the credit written
                onto it as text overlays — it is fetched as it is shown, rather than
                composed here.
              </p>
            </>
          )}

          {!card && !busy && status !== 'failed' && (
            <p className="mt-4 text-[10.5px] leading-relaxed text-mist-500">
              {localUrl
                ? 'The picture was taken, but the cloud would not take it, so there is no address to share — it is on this machine only.'
                : 'The address of the card appears here once the cloud has the picture.'}
            </p>
          )}

          {/* The buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!card}
              className="nb-btn nb-btn-ghost h-[38px] px-3 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <rect
                  x="9"
                  y="9"
                  width="11"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                />
                <path
                  d="M5 15V6a1 1 0 0 1 1-1h9"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
              {copied ? 'Copied' : 'Copy the link'}
            </button>

            <button
              type="button"
              onClick={() => void download()}
              disabled={!shown || pictureFailed}
              className="nb-btn nb-btn-ghost h-[38px] px-3 text-[11.5px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                <path
                  d="M12 4v10m0 0 4-4m-4 4-4-4M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download
            </button>

            <button
              type="button"
              onClick={close}
              className="nb-btn nb-btn-ghost h-[38px] px-3 text-[11.5px]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
