import type { BootTask } from '../hooks/useBootstrap';

function formatBytes(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * The loading screen.
 *
 * Every figure on it is measured: bytes received over the wire and chunks
 * actually built by the streaming workers. There are no timers and no
 * invented percentages.
 */
export function LoadingScreen({ tasks, ratio }: { tasks: BootTask[]; ratio: number }) {
  const pct = Math.round(ratio * 100);

  return (
    <div className="nb-sheen nb-grain fixed inset-0 z-60 flex flex-col items-center justify-center bg-ink-950/85 backdrop-blur-md">
      <div className="w-full max-w-md px-8">
        <div className="nb-fade-up flex flex-col items-center">
          <span className="nb-label mb-5 text-saffron/80">Bengaluru · Karnataka</span>
          <h1 className="nb-display text-center text-5xl font-light tracking-tight text-mist-100 sm:text-6xl">
            Namma&nbsp;Bengaluru
          </h1>
          <p className="nb-display mt-3 text-lg italic text-mist-300 sm:text-xl">
            Every street has a story.
          </p>
        </div>

        <div className="nb-fade-up mt-14" style={{ animationDelay: '120ms' }}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="nb-label">Building the city</span>
            <span className="font-mono text-[11px] tabular-nums text-mist-300">{pct}%</span>
          </div>

          <div className="h-px w-full overflow-hidden bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-saffron-dim via-saffron to-saffron-dim transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          <ul className="mt-6 space-y-2.5">
            {tasks.map((t) => {
              return (
                <li key={t.id} className="flex items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      t.done ? 'bg-saffron' : 'bg-white/20'
                    }`}
                  />
                  <span className="flex-1 text-[12px] tracking-wide text-mist-300">{t.label}</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-mist-400">
                    {t.done
                      ? 'ready'
                      : t.id === 'city'
                        ? `${t.loaded} / ${t.total} chunks`
                        : `${formatBytes(t.loaded)}${t.total ? ` / ${formatBytes(t.total)}` : ''}`}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-8 text-[11px] leading-relaxed text-mist-400">
            1.4 million building footprints from OpenStreetMap and Overture Maps, draped over
            elevation from AWS Terrain Tiles.
          </p>
        </div>
      </div>
    </div>
  );
}
