import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listPostcards, listedAssetUrl, type CloudAsset } from '../cloudinary/collections';
import { sentPostcards, type SentPostcard } from '../cloudinary/postcard';
import { config } from '../cloudinary/config';
import { useApp } from '../state/store';

/**
 * The postcard wall.
 *
 * Every postcard a visitor sends is uploaded with the tag `postcard`, and
 * Cloudinary can list everything carrying a tag. So the wall is not a list
 * this app keeps: it is a list the cloud keeps, and every visitor's picture
 * is in it, delivered from the same CDN as every other photograph in the
 * city.
 *
 * That is the point of the wall. The postcard feature on its own is a
 * novelty — a visitor sends a picture to a cloud and gets it back. The wall
 * is what makes it a place: the pictures everybody has sent this city, in
 * one grid, with the tags the cloud gave them.
 *
 * The listing is an account setting, so it is allowed to be missing. When it
 * is, the wall says so plainly and shows the postcards this browser sent
 * instead, rather than pretending that nobody has sent any.
 */

/** One card on the wall. */
interface WallCard {
  /** The Cloudinary public ID. */
  publicId: string;
  /** Where the cloud will deliver it, at wall size. */
  url: string;
  /** The words the cloud found in the picture. */
  tags: string[];
  /** The landmark it was taken of, when the cloud knew. */
  landmark: string | null;
  /** When it was sent. */
  when: string | null;
  /** The caption the visitor wrote, when this browser knows it. */
  caption: string | null;
}

export function PostcardWall({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<WallCard[] | null>(null);
  const [shared, setShared] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  /** The landmarks of the city, for naming the ones the postcards are of. */
  const landmarks = useApp((s) => s.landmarks);

  /**
   * The name of a landmark, from its id.
   *
   * A postcard carries the landmark as an id — `vidhana-soudha` — because
   * that is what the city calls it. The name is looked up here so that the
   * wall reads as a wall of places rather than a wall of slugs.
   */
  const landmarkName = (id: string | null): string | null => {
    if (!id) return null;
    const found = landmarks.find((l) => l.id === id);
    if (found) return found.name;
    return id.replace(/-/g, ' ');
  };

  const load = useCallback(async () => {
    setLoading(true);
    const listing = await listPostcards();

    if (listing) {
      setShared(true);
      setTotal(listing.total);
      setCards(
        listing.assets.map((asset: CloudAsset) => ({
          publicId: asset.publicId,
          url: listedAssetUrl(asset.publicId, 480),
          tags: asset.tags.filter(
            (t) => t !== 'postcard' && t !== 'bengaluru' && !t.startsWith('landmark:'),
          ),
          landmark: landmarkOf(asset) ?? asset.context.landmark ?? null,
          when: asset.createdAt,
          // The caption this browser wrote, or the one the cloud kept with
          // the picture — so somebody else's postcard still says what its
          // visitor said it said.
          caption: captionOf(asset.publicId) ?? asset.context.caption ?? null,
        })),
      );
      setLoading(false);
      return;
    }

    // The cloud will not say what it holds. The postcards this browser sent
    // are still known, and they are shown instead — with the reason stated,
    // because "there are none" and "we cannot ask" are different things.
    setShared(false);
    const mine = sentPostcards();
    setTotal(mine.length);
    setCards(
      mine.map((p: SentPostcard) => ({
        publicId: p.publicId,
        url: listedAssetUrl(p.publicId, 480),
        tags: p.autoTags,
        landmark: p.landmark,
        when: p.sentAt,
        caption: p.caption,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * The cards that can actually be shown.
   *
   * A card without a delivery address is not a card — there is no cloud to
   * deliver it from — so it is left out rather than shown as a broken
   * picture.
   */
  const showable = (cards ?? []).filter((card) => card.url !== '');

  return createPortal(
    <div className="nb-fade fixed inset-0 z-[75] bg-ink-950/96 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* The heading */}
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-8 sm:py-6">
          <div className="min-w-0">
            <span className="nb-label">The postcard wall</span>
            <h2 className="nb-display mt-1 text-[20px] leading-tight text-mist-100 sm:text-[24px]">
              Every picture of this city that somebody has sent
            </h2>
            <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-mist-400">
              A postcard is a frame of the city, sent to Cloudinary and tagged
              <span className="font-mono text-mist-300"> postcard</span>. The cloud lists
              everything carrying that tag and delivers them from its own CDN — so this wall
              is not a list this page keeps, it is a list the cloud keeps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nb-icon-btn shrink-0"
            aria-label="Close the postcard wall"
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

        {/* The wall */}
        <div className="nb-scroll flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          {loading && (
            <p className="text-[12px] text-mist-400">Asking the cloud what it holds…</p>
          )}

          {!loading && !shared && (
            <div className="mb-6 max-w-2xl rounded-sm border border-saffron/25 bg-saffron/8 p-4">
              <span className="nb-chip">The shared wall is not open</span>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist-300">
                This account does not let the cloud list what it holds, so the wall cannot
                show everybody&rsquo;s postcards — only the ones this browser sent. Listing
                by tag is a setting in the Cloudinary Media Library; turning it on makes
                the whole city&rsquo;s postcards appear here.
              </p>
            </div>
          )}

          {!loading && shared && cards && cards.length === 0 && (
            <p className="text-[12px] text-mist-400">
              Nobody has sent a postcard yet. Take one — the button is in the bar at the top
              of the city.
            </p>
          )}

          {!loading && !shared && cards && cards.length === 0 && (
            <p className="text-[12px] text-mist-400">
              This browser has not sent a postcard either. Take one — the button is in the
              bar at the top of the city.
            </p>
          )}

          {!loading && showable.length > 0 && (
            <>
              <p className="mb-4 font-mono text-[10.5px] tabular-nums text-mist-400">
                {showable.length} shown{total > showable.length ? ` of ${total}` : ''} ·{' '}
                {shared ? 'listed by the cloud' : 'sent from this browser'}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {showable.map((card) => (
                  <figure
                    key={card.publicId}
                    className="overflow-hidden rounded-sm border border-white/10 bg-ink-900"
                  >
                    <a
                      href={`https://res.cloudinary.com/${config.cloudName}/image/upload/${card.publicId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block"
                    >
                      <img
                        src={card.url}
                        alt={card.caption ?? 'A postcard of Bengaluru'}
                        loading="lazy"
                        className="block aspect-[4/3] w-full object-cover"
                      />
                    </a>
                    <figcaption className="px-2.5 py-2">
                      {card.caption && (
                        <p className="truncate text-[11px] text-mist-200">{card.caption}</p>
                      )}
                      {landmarkName(card.landmark) && (
                        <p className="truncate text-[10.5px] text-saffron/80">
                          {landmarkName(card.landmark)}
                        </p>
                      )}
                      {card.tags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {card.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-white/10 px-1.5 py-px font-mono text-[9px] text-mist-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </p>
                      )}
                      {card.when && (
                        <p className="mt-1 font-mono text-[9.5px] text-mist-500">
                          {card.when.slice(0, 10)}
                        </p>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 sm:px-8">
          <p className="text-[10.5px] leading-relaxed text-mist-500">
            The tags on each card are the cloud&rsquo;s own names for what it saw in the
            picture.
          </p>
          <button type="button" onClick={onClose} className="nb-btn nb-btn-ghost h-[36px] px-3 text-[11px]">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The landmark a postcard was taken of, if the cloud recorded one. */
function landmarkOf(asset: CloudAsset): string | null {
  const tag = asset.tags.find((t) => t.startsWith('landmark:'));
  if (!tag) return null;
  return tag.slice('landmark:'.length) || null;
}

/** The caption a postcard was given, if this browser wrote it. */
function captionOf(publicId: string): string | null {
  const mine = sentPostcards().find((p) => p.publicId === publicId);
  return mine?.caption ?? null;
}
