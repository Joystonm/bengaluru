import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { config, uploadPreset, uploadsEnabled, configurationProblem } from '../cloudinary/config';
import {
  CAPABILITIES,
  probeCapabilities,
  supportsNamed,
  type Capability,
} from '../cloudinary/capabilities';
import {
  FEATURES,
  featureUses,
  lastDeliveryUrl,
  noteDelivery,
  noteUse,
  totalRequests,
  usedFeatureCount,
} from '../cloudinary/usage';
import { explainDeliveryUrl } from '../cloudinary/explain';
import { landmarkPublicId } from '../cloudinary/imageDelivery';
import { loadPhotoManifest } from '../cloudinary/assetRegistry';
import { TRY_ITS, tryUrl, TILE_WIDTH, type TryIt } from '../cloudinary/tryIt';
import { useFilm } from '../state/filmStore';

/**
 * The engine room.
 *
 * A judge asks a simple question — *which Cloudinary features did you use?* —
 * and the honest answer is a list of twenty-odd parameters spread across
 * forty files, which is not an answer anybody can check.
 *
 * This panel is the answer, made checkable. It says four things:
 *
 *   1. What this account can actually do — asked of the cloud, live, rather
 *      than claimed. An add-on that is not enabled shows as not enabled.
 *   2. What the last delivery URL asked for, broken into its parts and
 *      explained in words. Any Cloudinary URL can be pasted in and read the
 *      same way.
 *   3. A wall of live demonstrations — the same photograph delivered a
 *      different way by each of the features below, fetched from the cloud
 *      as the panel opens, so a judge can watch them rather than read about
 *      them.
 *   4. Which features this browser has actually used — counted at the moment
 *      the cloud answered, so the tally is a record and not a claim. The
 *      features that have not been used are listed too, and say so.
 *
 * The API secret is nowhere in it. The browser has never had it, and does
 * not need it: delivery is public by design, and an upload is permitted by
 * the name of its preset.
 */

/** The add-ons worth asking about without charging for the question. */
const PROBED: Capability[] = ['art', 'background-removal', 'upscale', 'colourise'];

/** The named transformations the account is written to use. */
const NAMED: string[] = ['bengaluru_hero', 'bengaluru_thumb', 'bengaluru_card'];

/** Where things are filed in the cloud. */
const NAMESPACES: Array<{ path: string; what: string }> = [
  { path: 'bengaluru/landmarks', what: 'The photographs of the landmarks.' },
  { path: 'bengaluru/models', what: 'The externally authored 3D models.' },
  { path: 'bengaluru/video', what: 'The films of the city.' },
  { path: 'bengaluru/textures', what: 'The textures the 3D scene is dressed in.' },
  { path: 'bengaluru/contributions', what: 'Photographs visitors have offered.' },
  { path: 'bengaluru/postcards', what: 'The frames visitors have sent as postcards.' },
  { path: 'bengaluru/films', what: 'The films recorded in the browser.' },
];

/** A photograph of a landmark, used as the thing to ask the cloud about. */
async function aPublicId(): Promise<string | null> {
  try {
    const manifest = await loadPhotoManifest();
    const landmarks = manifest.landmarks;
    if (!landmarks) return null;
    for (const slug of Object.keys(landmarks)) {
      const entry = landmarks[slug];
      const first = entry?.images?.[0];
      if (first?.file) return landmarkPublicId(slug, first.file);
    }
  } catch {
    // A manifest that cannot be read simply means there is nothing to probe
    // with; the panel says so rather than guessing.
  }
  return null;
}

/**
 * A film already in the cloud, used to demonstrate the video pipeline.
 *
 * A visitor who has recorded a film in this browser has one of their own,
 * and that one is used instead. But a judge who opens the panel on a fresh
 * browser has no film, and the video half of the demonstration would have
 * nothing to show — so there is a film on the account to fall back on.
 */
const CLOUD_FILM = 'bengaluru/films/film-mwsrvr4z';

/**
 * The colour of each family of demonstration.
 *
 * The families are worth telling apart at a glance: the delivery ones are
 * what the app does quietly all the time, the filters are the cloud's own
 * effects, the AI ones are charged for, the words are the overlays, and the
 * video ones come out of the film pipeline rather than the picture one.
 */
const GROUP_COLOUR: Record<TryIt['group'], string> = {
  Delivery: '#8fb4d9',
  Filters: '#c9a227',
  AI: '#ff6fb5',
  Words: '#7fbf5a',
  Video: '#e2955a',
};

/** The name of each feature, so a chip says what it is and not what it is called. */
const FEATURE_LABELS = new Map(FEATURES.map((f) => [f.id, f.label]));

export function EngineRoom({ onClose }: { onClose: () => void }) {
  /** What the cloud said it can do. */
  const [addOns, setAddOns] = useState<Partial<Record<Capability, boolean>>>({});
  /** What the cloud said about the named transformations. */
  const [named, setNamed] = useState<Record<string, boolean>>({});
  /** Whether the questions are still being asked. */
  const [asking, setAsking] = useState(true);
  /** The public ID the questions were asked about. */
  const [asked, setAsked] = useState<string | null>(null);

  /** The URL being read. */
  const [url, setUrl] = useState(() => lastDeliveryUrl());
  /** Whether the last address has been copied. */
  const [copied, setCopied] = useState(false);

  /** The demonstration the visitor has asked to see. */
  const [chosen, setChosen] = useState<string | null>(null);
  /**
   * What the cloud said about each demonstration.
   *
   * A demonstration that fails is not a broken page: an add-on that the
   * account does not have answers with an error instead of a picture, and
   * saying so is more useful than hiding the tile.
   */
  const [tried, setTried] = useState<Record<string, 'ok' | 'failed'>>({});
  /** Bumped whenever something was counted, so the tally is read afresh. */
  const [tallyTick, setTallyTick] = useState(0);

  /**
   * Ask the cloud what it can do.
   *
   * The questions are asked once, when the panel opens, and the answers are
   * cached for the session — so the second time somebody opens the panel
   * there is nothing to wait for.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      const publicId = await aPublicId();
      if (!live) return;
      setAsked(publicId);
      if (!publicId) {
        setAsking(false);
        return;
      }
      const answers = (await probeCapabilities(PROBED, publicId)) as Partial<
        Record<Capability, boolean>
      >;
      const namedAnswers: Record<string, boolean> = {};
      for (const name of NAMED) {
        namedAnswers[name] = await supportsNamed(name, publicId);
      }
      if (!live) return;
      setAddOns(answers);
      setNamed(namedAnswers);
      setAsking(false);
    })();
    return () => {
      live = false;
    };
  }, []);

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

  /** The URL, taken apart. */
  const explained = useMemo(() => explainDeliveryUrl(url), [url]);

  /** The features, and how often each has been used this session. */
  const features = useMemo(() => featureUses(), [tallyTick]);
  const requests = totalRequests();
  const used = usedFeatureCount();

  /**
   * The film the video demonstrations are asked of.
   *
   * A film recorded in this browser is used when there is one, because that
   * is the film the visitor actually made; otherwise the film already on the
   * account stands in.
   */
  const ownFilm = useFilm((s) => s.film?.publicId ?? null);
  const videoId = ownFilm ?? CLOUD_FILM;

  /**
   * Count a demonstration, now that the cloud has answered.
   *
   * The features are counted at the moment the picture comes back, not when
   * the address is built — so a demonstration that the account cannot do is
   * not counted as used, which is the whole point of counting honestly.
   *
   * Each demonstration is counted once. The same transformation is asked for
   * twice — once small, for the tile, and once large, for the picture the
   * visitor has asked to see — and it is one feature used, not two.
   */
  const counted = useRef(new Set<string>());

  const count = useCallback((demo: TryIt, address: string) => {
    noteDelivery(address);
    if (counted.current.has(demo.id)) {
      setTried((before) => (before[demo.id] === 'ok' ? before : { ...before, [demo.id]: 'ok' }));
      return;
    }
    counted.current.add(demo.id);
    for (const feature of demo.features ?? []) noteUse(feature);
    setTried((before) => ({ ...before, [demo.id]: 'ok' }));
    setTallyTick((n) => n + 1);
  }, []);

  /** The cloud could not do this one. */
  const failed = useCallback((demo: TryIt) => {
    setTried((before) => ({ ...before, [demo.id]: 'failed' }));
  }, []);

  /**
   * Choose a demonstration.
   *
   * The streaming manifest is not a picture, so there is nothing for a tile
   * to show; instead the address is asked of the cloud directly, and the
   * answer — the manifest itself — is what counts.
   */
  const choose = useCallback(
    (demo: TryIt) => {
      setChosen(demo.id);
      if (demo.extension !== 'm3u8') return;
      const address = tryUrl(demo, videoId);
      void fetch(address)
        .then((res) => {
          if (!res.ok) {
            failed(demo);
            return;
          }
          count(demo, address);
        })
        .catch(() => {
          // The manifest could not be read from the page — the browser will
          // not hand over an answer from another origin — but it is still
          // there, and the link beside it opens it.
        });
    },
    [videoId, count, failed],
  );

  /** The last address the app asked the cloud for. */
  const last = lastDeliveryUrl();

  const copyLast = useCallback(async () => {
    if (!last) return;
    try {
      await navigator.clipboard.writeText(last);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // A browser that will not hand over the clipboard still shows the
      // address underneath, where it can be selected by hand.
      setCopied(false);
    }
  }, [last]);

  return (
    createPortal(
      <div className="nb-fade fixed inset-0 z-[75] bg-ink-950/96 backdrop-blur-xl">
        <div className="flex h-full flex-col">
          {/* The heading */}
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-8 sm:py-6">
            <div className="min-w-0">
              <span className="nb-label">The engine room</span>
              <h2 className="nb-display mt-1 text-[20px] leading-tight text-mist-100 sm:text-[24px]">
                What this city asks of the cloud
              </h2>
              <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-mist-400">
                Every photograph, film and postcard in this place is delivered by
                Cloudinary — cropped, sized, compressed and, where it has been asked for,
                painted. This panel shows what the account can do, what the last address
                asked for, and which features this browser has genuinely used.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="nb-icon-btn shrink-0"
              aria-label="Close the engine room"
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

          <div className="nb-scroll flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            {/* ---------------------------------------------------- the cloud */}
            <section className="mb-8">
              <h3 className="nb-label">The cloud</h3>
              <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <Row term="Cloud name">
                  <span className="font-mono text-[11.5px] text-mist-200">
                    {config.cloudName || 'not configured'}
                  </span>
                </Row>
                <Row term="Namespaces">
                  <span className="font-mono text-[11.5px] text-mist-200">
                    {config.root}/*
                  </span>
                </Row>
                <Row term="Uploads">
                  {uploadsEnabled ? (
                    <span className="text-[11.5px] text-mist-300">
                      The browser may upload. The preset name is the permission —{' '}
                      <span className="font-mono text-mist-200">{uploadPreset}</span> — and
                      no API secret is involved.
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-mist-400">
                      {configurationProblem ??
                        'This build has no upload preset, so the browser cannot upload.'}
                    </span>
                  )}
                </Row>
                <Row term="The secret">
                  <span className="text-[11.5px] text-mist-400">
                    The API secret has never been in the browser and is not needed there.
                    Delivery addresses are public by design.
                  </span>
                </Row>
              </dl>
            </section>

            {/* --------------------------------------------- what it can do */}
            <section className="mb-8">
              <h3 className="nb-label">What this account can do</h3>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-mist-400">
                Asked of the cloud rather than assumed. The AI effects are add-ons, and an
                add-on that is not enabled answers with an error instead of a picture — so
                the photograph viewer checks before it offers them.
              </p>

              {asking && (
                <p className="mt-3 text-[11.5px] text-mist-400">Asking the cloud…</p>
              )}

              {!asking && !asked && (
                <p className="mt-3 text-[11.5px] text-mist-400">
                  There is no photograph in the library to ask with, so nothing was asked.
                </p>
              )}

              {!asking && asked && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PROBED.map((capability) => (
                    <Verdict
                      key={capability}
                      ok={addOns[capability] === true}
                      title={CAPABILITIES[capability].label}
                      note={CAPABILITIES[capability].note}
                    />
                  ))}
                </div>
              )}

              {!asking && asked && (
                <>
                  <p className="nb-label mt-6">Named transformations</p>
                  <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-mist-400">
                    A transformation written down once in the account and used by name, so
                    the shape of a photograph is decided in one place rather than in every
                    URL. These are created by the setup script.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {NAMED.map((name) => (
                      <Verdict
                        key={name}
                        ok={named[name] === true}
                        title={name}
                        note={
                          named[name] === true
                            ? 'Written down in the account and answering.'
                            : 'Not in the account yet — the app falls back to writing the transformation out in full.'
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* -------------------------------------------------------- try it */}
            <section className="mb-8">
              <h3 className="nb-label">Try it</h3>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-mist-400">
                Every tile below is a live request to the cloud, asking for the same
                photograph delivered a different way. The pictures arrive as the panel
                opens, so the tally underneath fills in as they land. Press one to see it
                at full size and to be given the address it came from.
              </p>

              {!asked && (
                <p className="mt-3 text-[11.5px] text-mist-400">
                  There is no photograph in the library to try this with, so there is
                  nothing to ask the cloud for.
                </p>
              )}

              {asked && (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {TRY_ITS.map((demo) => (
                      <TryTile
                        key={demo.id}
                        demo={demo}
                        publicId={demo.kind === 'video' ? videoId : asked}
                        state={tried[demo.id]}
                        chosen={chosen === demo.id}
                        enabled={
                          demo.capability ? addOns[demo.capability] : undefined
                        }
                        onChoose={() => choose(demo)}
                        onCount={(address) => count(demo, address)}
                        onFail={() => failed(demo)}
                      />
                    ))}
                  </div>

                  <p className="mt-3 max-w-2xl text-[10.5px] leading-relaxed text-mist-500">
                    These are the delivery side of the cloud. The other side — the
                    unsigned uploads, the upload widget, the auto-tagging and the
                    contextual metadata — is counted when a visitor sends a postcard or
                    offers a photograph, and the tally below shows them once they have
                    happened.
                  </p>

                  {chosen && (
                    <TryDetail
                      demo={TRY_ITS.find((d) => d.id === chosen) ?? null}
                      publicId={
                        (TRY_ITS.find((d) => d.id === chosen)?.kind ?? 'image') === 'video'
                          ? videoId
                          : asked
                      }
                      state={tried[chosen]}
                      onCount={(address) => {
                        const demo = TRY_ITS.find((d) => d.id === chosen);
                        if (demo) count(demo, address);
                      }}
                      onFail={() => {
                        const demo = TRY_ITS.find((d) => d.id === chosen);
                        if (demo) failed(demo);
                      }}
                    />
                  )}
                </>
              )}
            </section>

            {/* -------------------------------------------- read a delivery */}
            <section className="mb-8">
              <h3 className="nb-label">Read a delivery address</h3>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-mist-400">
                A Cloudinary address is a sentence with the words run together. Paste one —
                the app&rsquo;s own, or any other — and it is read back in words.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  placeholder="https://res.cloudinary.com/…"
                  className="min-w-0 flex-1 rounded-sm border border-white/12 bg-ink-950/60 px-2.5 py-2 font-mono text-[11px] text-mist-200 outline-none placeholder:text-mist-500 focus:border-saffron/50"
                />
                {last && (
                  <button
                    type="button"
                    onClick={() => setUrl(last)}
                    className="nb-btn nb-btn-ghost h-[34px] px-3 text-[11px]"
                  >
                    The last one
                  </button>
                )}
              </div>

              {explained.unknown ? (
                <p className="mt-3 text-[11.5px] text-mist-400">
                  That is not a Cloudinary delivery address, so there is nothing to read in
                  it.
                </p>
              ) : (
                <div className="mt-3">
                  <p className="font-mono text-[10.5px] text-mist-500">
                    {explained.cloud}/{explained.resourceType} · {explained.publicId}
                  </p>
                  {explained.parts.length === 0 ? (
                    <p className="mt-2 text-[11.5px] text-mist-400">
                      No transformation — the original is being delivered as it is.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {explained.parts.map((part, i) => (
                        <li
                          key={`${part.raw}-${i}`}
                          className="flex flex-col gap-0.5 border-l border-white/10 pl-3 sm:flex-row sm:gap-3"
                        >
                          <span className="shrink-0 font-mono text-[10.5px] text-saffron/90 sm:w-52">
                            {part.raw}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[11.5px] text-mist-200">
                              {part.label}
                            </span>
                            <span className="block text-[10.5px] leading-relaxed text-mist-400">
                              {part.detail}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {last && (
                <p className="mt-3 text-[10.5px] leading-relaxed text-mist-500">
                  The last address this browser asked for:{' '}
                  <button
                    type="button"
                    onClick={() => void copyLast()}
                    className="font-mono text-mist-400 underline decoration-white/20 underline-offset-2 hover:text-mist-200"
                  >
                    {copied ? 'copied' : 'copy it'}
                  </button>
                </p>
              )}
            </section>

            {/* --------------------------------------------- what was used */}
            <section className="mb-8">
              <h3 className="nb-label">What has been used</h3>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-mist-400">
                Counted at the moment the delivery addresses were built, so this is a record
                of what the cloud was actually asked for — not a claim about it. The
                features that have not been used are listed too, and say so.
              </p>
              <p className="mt-3 font-mono text-[10.5px] tabular-nums text-mist-400">
                {used} of {features.length} features used · {requests} request
                {requests === 1 ? '' : 's'} made this session
              </p>

              <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 lg:grid-cols-2">
                {features.map((feature) => (
                  <li
                    key={feature.id}
                    className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5"
                  >
                    <span className="min-w-0">
                      <span
                        className={
                          feature.count > 0 ? 'text-[11.5px] text-mist-200' : 'text-[11.5px] text-mist-500'
                        }
                      >
                        {feature.label}
                      </span>
                      <span className="block text-[10.5px] leading-relaxed text-mist-500">
                        {feature.count > 0 ? feature.note : 'Not used in this session.'}
                      </span>
                    </span>
                    <span
                      className={
                        feature.count > 0
                          ? 'shrink-0 font-mono text-[10.5px] tabular-nums text-saffron/90'
                          : 'shrink-0 font-mono text-[10.5px] tabular-nums text-mist-500'
                      }
                    >
                      {feature.count > 0 ? `×${feature.count}` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* ---------------------------------------------- where things live */}
            <section className="mb-4">
              <h3 className="nb-label">Where things live</h3>
              <ul className="mt-3 space-y-1.5">
                {NAMESPACES.map((ns) => (
                  <li key={ns.path} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono text-[11px] text-mist-300">{ns.path}</span>
                    <span className="text-[10.5px] text-mist-500">{ns.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 sm:px-8">
            <p className="max-w-2xl text-[10.5px] leading-relaxed text-mist-500">
              Generative fill is not asked about here: the account is charged for it, so it
              is asked about only when somebody actually wants a wider frame.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="nb-btn nb-btn-ghost h-[36px] shrink-0 px-3 text-[11px]"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  );
}

/** A term and its answer. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="nb-label">{term}</dt>
      <dd className="mt-1 leading-relaxed">{children}</dd>
    </div>
  );
}

/**
 * One demonstration, as a tile.
 *
 * Most of them are free, and those are fetched as the panel opens — the
 * picture in the tile *is* the request, and the tally underneath fills in as
 * the tiles land.
 *
 * The AI ones are not. An add-on is charged for by the cloud every time it
 * is used, so a tile that needs one waits to be pressed: the tile says so,
 * and the press is the asking.
 */
function TryTile({
  demo,
  publicId,
  state,
  chosen,
  enabled,
  onChoose,
  onCount,
  onFail,
}: {
  demo: TryIt;
  publicId: string;
  state?: 'ok' | 'failed';
  chosen: boolean;
  /** What the cloud said about the add-on this needs, when it needs one. */
  enabled?: boolean;
  onChoose: () => void;
  onCount: (address: string) => void;
  onFail: () => void;
}) {
  /** Whether a paid-for demonstration has been asked for. */
  const [armed, setArmed] = useState(false);

  /** Whether the cloud is charged for this one. */
  const charged = demo.capability !== undefined;
  /** Whether the delivery is a stream rather than a picture. */
  const manifest = demo.extension === 'm3u8';

  /** Whether the account has been found not to have the add-on. */
  const unavailable = enabled === false;

  const address = manifest
    ? tryUrl(demo, publicId)
    : tryUrl(demo, publicId, TILE_WIDTH);

  /** The colour of the family. */
  const colour = GROUP_COLOUR[demo.group];

  /**
   * Press the tile.
   *
   * A paid-for demonstration is armed by the same press that selects it, so
   * that one press does both things and the tile fills in with the result.
   */
  const press = () => {
    if (charged) setArmed(true);
    onChoose();
  };

  return (
    <div
      className={
        chosen
          ? 'flex flex-col overflow-hidden rounded-sm border border-saffron/45 bg-ink-900/70'
          : 'flex flex-col overflow-hidden rounded-sm border border-white/8 bg-ink-900/40'
      }
    >
      <button
        type="button"
        onClick={press}
        disabled={unavailable}
        className="group relative block aspect-[3/2] w-full overflow-hidden bg-ink-950 disabled:cursor-not-allowed"
        aria-label={`${demo.label} — ${demo.note}`}
      >
        {unavailable ? (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M5 5l14 14M19 5L5 19"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mist-500">
              Not on this account
            </span>
          </span>
        ) : manifest ? (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 6h16v12H4zM10 9l5 3-5 3z"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mist-400">
              A manifest, not a picture
            </span>
          </span>
        ) : charged && !armed ? (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M12 4l2.4 5.1 5.6.7-4.1 3.9 1.1 5.5L12 16.6 7 19.2l1.1-5.5L4 9.8l5.6-.7z"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-mist-400">
              Press to ask the cloud
            </span>
          </span>
        ) : (
          <img
            src={address}
            alt={demo.label}
            loading="lazy"
            className="h-full w-full object-cover"
            onLoad={() => onCount(address)}
            onError={onFail}
          />
        )}
      </button>

      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="min-w-0 truncate text-[11px] text-mist-200">{demo.label}</span>
        <span
          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]"
          style={{ color: unavailable || state === 'failed' ? undefined : colour }}
        >
          {unavailable ? (
            <span className="text-mist-500">not enabled</span>
          ) : state === 'failed' ? (
            <span className="text-mist-500">would not do it</span>
          ) : (
            demo.group
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The demonstration the visitor has asked to see, at full size.
 *
 * The address is given in full, because the address *is* the feature: a
 * Cloudinary delivery URL is a sentence with the words run together, and
 * seeing it written out is how a judge can check that the cloud is really
 * being asked for what is claimed.
 */
function TryDetail({
  demo,
  publicId,
  state,
  onCount,
  onFail,
}: {
  demo: TryIt | null;
  publicId: string;
  state?: 'ok' | 'failed';
  onCount: (address: string) => void;
  onFail: () => void;
}) {
  if (!demo) return null;

  const manifest = demo.extension === 'm3u8';
  const address = tryUrl(demo, publicId);

  return (
    <div className="mt-4 rounded-sm border border-white/10 bg-ink-900/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {!manifest && (
          <div className="shrink-0 overflow-hidden rounded-sm border border-white/10 bg-ink-950 sm:w-64">
            <img
              src={address}
              alt={demo.label}
              className="block w-full"
              onLoad={() => onCount(address)}
              onError={onFail}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="font-mono text-[9.5px] uppercase tracking-[0.14em]"
              style={{ color: GROUP_COLOUR[demo.group] }}
            >
              {demo.group}
            </span>
            <span className="text-[13px] text-mist-100">{demo.label}</span>
            {state === 'failed' && (
              <span className="nb-chip">The cloud would not do this one</span>
            )}
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-mist-300">{demo.note}</p>

          {demo.features && demo.features.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {demo.features.map((feature) => (
                <span key={feature} className="nb-chip">
                  {FEATURE_LABELS.get(feature) ?? feature}
                </span>
              ))}
            </p>
          )}

          <p className="nb-label mt-3">The address</p>
          <p className="mt-1.5 select-all break-all rounded-sm bg-ink-950/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-mist-400">
            {address}
          </p>

          {manifest && (
            <a
              href={address}
              target="_blank"
              rel="noopener noreferrer"
              className="nb-btn nb-btn-ghost mt-3 h-[36px] px-3 text-[11.5px]"
            >
              Open the manifest
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Whether the cloud can do a thing, and what that means. */
function Verdict({
  ok,
  title,
  note,
}: {
  ok: boolean;
  title: string;
  note: string;
}) {
  return (
    <div className="rounded-sm border border-white/8 bg-ink-900/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] text-mist-200">{title}</span>
        <span
          className={
            ok
              ? 'shrink-0 rounded-full border border-saffron/35 px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.12em] text-saffron'
              : 'shrink-0 rounded-full border border-white/10 px-2 py-px font-mono text-[9.5px] uppercase tracking-[0.12em] text-mist-500'
          }
        >
          {ok ? 'enabled' : 'not enabled'}
        </span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-mist-400">{note}</p>
    </div>
  );
}
