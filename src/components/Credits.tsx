import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { DATA_SOURCES, MODEL_NOTES, summariseLicenses } from '../data/credits';
import { deliverySummary, loadPhotoManifest } from '../cloudinary/assetRegistry';
import type { LandmarkPhotoRecord, PhotoManifest } from '../cloudinary/assetRegistry';
import { probeRenditions } from '../cloudinary/diagnostics';
import type { RenditionProbe } from '../cloudinary/diagnostics';

/** The Commons file title, without the "File:" prefix or the extension. */
function photoTitle(img: LandmarkPhotoRecord): string {
  return (
    img.commonsTitle?.replace(/^File:/, '').replace(/\.[A-Za-z0-9]+$/, '') ?? img.file
  );
}

/**
 * The credits panel.
 *
 * Every source this city was built from, and every photograph in it, with the
 * licence each one was used under. It is reachable from anywhere in the app
 * and never asks the viewer to configure anything.
 */
export function Credits() {
  const open = useApp((s) => s.creditsOpen);
  const setCreditsOpen = useApp((s) => s.setCreditsOpen);
  const [manifest, setManifest] = useState<PhotoManifest | null>(null);
  const [probes, setProbes] = useState<{ key: string; rows: RenditionProbe[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadPhotoManifest().then((m) => {
      if (live) setManifest(m);
    });
    return () => {
      live = false;
    };
  }, [open]);

  /**
   * The photograph whose renditions are checked.
   *
   * One photograph is enough to prove the delivery layer is working — every
   * photograph goes through the same transformations.
   */
  const probeTarget = useMemo(() => {
    const entry = Object.entries(manifest?.landmarks ?? {})[0];
    const image = entry?.[1]?.images?.[0];
    if (!entry || !image) return null;
    return { slug: entry[0], file: image.file, key: `${entry[0]}/${image.file}` };
  }, [manifest]);

  // Ask the edge for every rendition the app uses, so the delivery section
  // reports what the cloud is actually serving rather than what the code
  // intends to ask for.
  useEffect(() => {
    if (!open || !probeTarget) return;
    let live = true;
    void probeRenditions(probeTarget.slug, probeTarget.file).then((rows) => {
      if (live) setProbes({ key: probeTarget.key, rows });
    });
    return () => {
      live = false;
    };
  }, [open, probeTarget]);

  /** The rows that belong to the photograph being checked, and nothing older. */
  const rows = probes && probes.key === probeTarget?.key ? probes.rows : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCreditsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setCreditsOpen]);

  const landmarks = useApp((s) => s.landmarks);

  const photoGroups = useMemo(() => {
    /*
      The manifest is keyed by the folder the photographs live in, which is not
      always the landmark's id — `iskcon-temple-bengaluru` keeps its pictures
      in `iskcon-temple/`. Build the link from the photograph paths so the
      panel shows the landmark's proper name.
    */
    const namesByFolder = new Map<string, string>();
    for (const l of landmarks) {
      for (const p of l.photos) {
        const folder = p.src.split('/')[0];
        if (folder && !namesByFolder.has(folder)) namesByFolder.set(folder, l.name);
      }
    }

    const entries = Object.entries(manifest?.landmarks ?? {});
    return entries
      .map(([slug, entry]) => ({
        slug,
        displayName:
          namesByFolder.get(slug) ??
          landmarks.find((l) => l.id === slug)?.name ??
          (entry.displayName && entry.displayName !== slug
            ? entry.displayName
            : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
        images: entry.images ?? [],
      }))
      .filter((g) => g.images.length > 0)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [manifest, landmarks]);

  const licenses = useMemo(
    () =>
      photoGroups.flatMap((g) =>
        g.images.map((i) => i.license ?? 'See source'),
      ),
    [photoGroups],
  );

  const photoCount = useMemo(
    () => photoGroups.reduce((n, g) => n + g.images.length, 0),
    [photoGroups],
  );

  const delivery = deliverySummary();

  if (!open) return null;

  return (
    <div
      className="nb-fade fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-ink-950/95 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Sources and credits"
    >
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-10 sm:px-10 sm:pt-16">
        {/* Header */}
        <header className="flex items-start justify-between gap-6">
          <div>
            <span className="nb-label text-saffron/85">Namma Bengaluru</span>
            <h2 className="nb-display mt-3 text-[clamp(2rem,5vw,3.2rem)] leading-tight text-mist-100">
              Sources &amp; credits
            </h2>
            <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-mist-300">
              This city is assembled from open data and real photographs. Nothing in it
              was generated in place of something that exists. The licences below are the
              licences the data was used under.
            </p>
          </div>

          <button
            type="button"
            className="nb-icon-btn shrink-0"
            onClick={() => setCreditsOpen(false)}
            aria-label="Close credits"
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
        </header>

        <div className="nb-hairline my-9" />

        {/* Data sources */}
        <section>
          <h3 className="nb-display text-2xl text-mist-100">The data</h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mist-400">
            Roads, water, parks, railways, building footprints and elevation. Each
            source is credited with the licence it was used under.
          </p>

          <dl className="mt-6 space-y-6">
            {DATA_SOURCES.map((s) => (
              <div key={s.name} className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-6">
                <dt>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[14px] text-mist-100 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-saffron"
                  >
                    {s.name}
                  </a>
                  <p className="mt-1">
                    <a
                      href={s.licenseUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="nb-chip h-auto py-0.5 text-[9.5px] normal-case tracking-normal no-underline transition-colors hover:text-saffron"
                    >
                      {s.license}
                    </a>
                  </p>
                </dt>
                <dd className="text-[13px] leading-relaxed text-mist-300">
                  <p>{s.usedFor}</p>
                  {s.note && <p className="mt-1.5 text-mist-500">{s.note}</p>}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="nb-hairline my-9" />

        {/* Models */}
        <section>
          <h3 className="nb-display text-2xl text-mist-100">The models</h3>
          <dl className="mt-5 space-y-4">
            {MODEL_NOTES.map((m) => (
              <div key={m.name}>
                <dt className="text-[13px] text-mist-200">{m.name}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-mist-400">{m.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="nb-hairline my-9" />

        {/* Photographs */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="nb-display text-2xl text-mist-100">The photographs</h3>
            <span className="font-mono text-[10.5px] tabular-nums text-mist-500">
              {photoCount} photographs · {photoGroups.length} landmarks
            </span>
          </div>

          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mist-400">
            {photoCount > 0
              ? `Every photograph is a real photograph of the real place, taken from Wikimedia Commons. Licences in use: ${summariseLicenses(licenses)}.`
              : 'The photograph manifest is still loading.'}
          </p>

          {photoGroups.length === 0 ? (
            <p className="mt-5 text-[13px] text-mist-500">Loading the credit list…</p>
          ) : (
            <div className="mt-6 space-y-5">
              {photoGroups.map((g) => (
                <details key={g.slug} className="group border-b border-white/8 pb-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-mist-100 transition-colors hover:text-saffron">
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      aria-hidden="true"
                      className="shrink-0 text-mist-500 transition-transform group-open:rotate-90"
                    >
                      <path
                        d="m9 5 7 7-7 7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="flex-1">{g.displayName}</span>
                    <span className="font-mono text-[10.5px] tabular-nums text-mist-500">
                      {g.images.length}
                    </span>
                  </summary>

                  <ul className="mt-3 space-y-2 pl-[21px]">
                    {g.images.map((img: LandmarkPhotoRecord) => (
                      <li key={img.file} className="text-[12px] leading-relaxed text-mist-400">
                        {img.commonsUrl ? (
                          <a
                            href={img.commonsUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-mist-200 underline decoration-white/20 underline-offset-2 transition-colors hover:text-saffron"
                          >
                            {photoTitle(img)}
                          </a>
                        ) : (
                          <span className="text-mist-200">{photoTitle(img)}</span>
                        )}
                        <span className="text-mist-500">{` — `}</span>
                        <span className="text-mist-300">{img.author ?? 'Unknown author'}</span>
                        <span className="text-mist-500">{` · `}</span>
                        {img.licenseUrl ? (
                          <a
                            href={img.licenseUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-mist-400 underline decoration-white/15 underline-offset-2 transition-colors hover:text-saffron"
                          >
                            {img.license ?? 'licence'}
                          </a>
                        ) : (
                          <span className="text-mist-400">{img.license ?? 'licence'}</span>
                        )}
                        {img.attributionRequired && (
                          <span className="text-mist-500">{` (attribution required)`}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>

        <div className="nb-hairline my-9" />

        {/* Delivery */}
        <section>
          <h3 className="nb-display text-2xl text-mist-100">Delivery</h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mist-400">
            {delivery.enabled ? (
              <>
                Photographs are delivered through Cloudinary under the{' '}
                <span className="font-mono text-mist-300">{delivery.root}/…</span>{' '}
                namespace in cloud{' '}
                <span className="font-mono text-mist-300">{delivery.cloudName}</span>, with
                automatic format and quality and responsive widths.
              </>
            ) : (
              <>
                No Cloudinary cloud name is configured, so the photographs are served
                from the app&rsquo;s own asset directory. The delivery layer is the same
                either way; setting a cloud name switches it over.
              </>
            )}
          </p>

          {delivery.enabled && (
            <>
              <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-mist-400">
                The app asks the cloud for six different renditions of every photograph.
                These are live requests to the edge — what is shown is what the CDN
                actually returned just now, not what the code intends to ask for.
              </p>

              <div className="mt-4 overflow-hidden rounded-sm border border-white/8">
                <table className="w-full text-left text-[11.5px]">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/3 text-mist-400">
                      <th className="px-3 py-2 font-normal">Rendition</th>
                      <th className="px-3 py-2 font-normal">Used for</th>
                      <th className="px-3 py-2 font-normal">Status</th>
                      <th className="px-3 py-2 text-right font-normal">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-mist-500">
                          Asking the edge…
                        </td>
                      </tr>
                    )}
                    {rows.map((p) => (
                      <tr key={p.label} className="border-b border-white/5 last:border-0">
                        <td className="px-3 py-2 align-top text-mist-200">{p.label}</td>
                        <td className="px-3 py-2 align-top text-mist-500">{p.used}</td>
                        <td className="px-3 py-2 align-top">
                          {p.ok ? (
                            <span className="text-saffron/85">
                              {p.status} · {p.format?.replace('image/', '') ?? 'ok'}
                            </span>
                          ) : (
                            <span className="text-red-300/90">
                              {p.status ?? 'failed'}
                              {p.error ? ` · ${p.error}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right align-top font-mono tabular-nums text-mist-400">
                          {p.bytes === null ? '—' : `${Math.round(p.bytes / 1024)} KB`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-mist-500">
                {rows.length > 0 && rows.every((p) => p.ok)
                  ? `All ${rows.length} renditions were served from ${delivery.cloudName}.`
                  : 'Some renditions did not come back — see the statuses above.'}
              </p>
            </>
          )}
        </section>

        <p className="mt-12 text-center text-[11px] leading-relaxed text-mist-500">
          Namma Bengaluru · Every street has a story.
        </p>
      </div>
    </div>
  );
}
