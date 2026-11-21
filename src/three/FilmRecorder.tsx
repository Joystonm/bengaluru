import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useFilm } from '../state/filmStore';
import { rig, normaliseRig } from './rig';
import { uploadFilm } from '../cloudinary/videoDelivery';
import { configurationRemedy, uploadsEnabled } from '../cloudinary/config';

/**
 * The film recorder.
 *
 * This lives inside the 3D canvas because what it records is the canvas: the
 * scene is drawn, the drawing is copied into a second canvas, and that second
 * canvas is what the camera records. Nothing is downloaded and re-encoded —
 * the film is made from the frames that were already being drawn.
 *
 * The copy is made inside a `requestAnimationFrame` callback that renders the
 * scene itself first. A WebGL drawing buffer is cleared once it has been
 * shown, so reading it at an arbitrary moment can return nothing at all;
 * rendering and reading within the same task avoids that entirely.
 *
 * While the film is being made the camera turns slowly on its own, so the
 * result has movement in it even if nobody touches anything.
 */

/** How long a film may run, in seconds. */
const MAX_SECONDS = 30;

/** The frames a second of film is made of. */
const FPS = 30;

/** How wide the film is, in pixels. */
const OUT_WIDTH = 1280;

/** The codecs worth trying, best first. */
const MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/** The first codec this browser will actually record in. */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/** `1:04` — the length of a film. */
function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function FilmRecorder() {
  const { gl, scene, camera } = useThree();
  const recording = useFilm((s) => s.recording);
  const finish = useFilm((s) => s.finish);
  const fail = useFilm((s) => s.fail);
  const tick = useFilm((s) => s.tick);

  // The pieces of the recording that the effect below needs to reach.
  const live = useRef<{
    raf: number;
    recorder: MediaRecorder;
    started: number;
    stopped: boolean;
  } | null>(null);

  useEffect(() => {
    if (!recording) return;

    const mime = pickMimeType();
    if (!mime) {
      fail('This browser cannot record video, so the film was not made.');
      return;
    }

    // The film is drawn at the shape of the window, so nothing is stretched.
    const source = gl.domElement;
    const out = document.createElement('canvas');
    out.width = OUT_WIDTH;
    out.height = Math.max(
      2,
      Math.round((OUT_WIDTH * source.height) / Math.max(1, source.width)),
    );
    const ctx = out.getContext('2d');
    if (!ctx) {
      fail('The film could not be drawn, so it was not made.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = out.captureStream(FPS);
    } catch {
      fail('This browser cannot capture the canvas, so the film was not made.');
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    } catch {
      fail('This browser could not start the recorder, so the film was not made.');
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const started = performance.now();
    recorder.start(250);

    /** End the recording. */
    const stop = () => {
      const state = live.current;
      if (!state || state.stopped) return;
      state.stopped = true;
      cancelAnimationFrame(state.raf);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    /** The last whole second reported, so the clock only moves once a second. */
    let reported = -1;

    /**
     * The frame of the film.
     *
     * The scene is drawn again here so that the copy taken of it is of a
     * drawing buffer that is known to hold a picture.
     */
    const draw = () => {
      const state = live.current;
      if (!state) return;
      state.raf = requestAnimationFrame(draw);

      gl.render(scene, camera);
      ctx.drawImage(source, 0, 0, out.width, out.height);

      const seconds = (performance.now() - started) / 1000;

      // A slow turn, so the film has something happening in it.
      rig.azimuth += 0.0021;
      normaliseRig(rig);

      // The title, burnt into the film rather than laid over it later.
      const w = out.width;
      const h = out.height;
      const scale = w / 1280;

      const vignette = ctx.createRadialGradient(
        w / 2,
        h / 2,
        h * 0.32,
        w / 2,
        h / 2,
        h * 0.86,
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.46)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(7,9,12,0.62)';
      ctx.fillRect(0, h - 96 * scale, w, 96 * scale);

      ctx.fillStyle = '#e8a33d';
      ctx.fillRect(56 * scale, h - 58 * scale, 44 * scale, 2 * scale);

      ctx.fillStyle = '#e8edf3';
      ctx.font = `300 ${34 * scale}px Georgia, 'Times New Roman', serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Namma Bengaluru', 56 * scale, h - 26 * scale);

      ctx.fillStyle = '#a4b0c0';
      ctx.font = `${16 * scale}px ui-monospace, 'SF Mono', Menlo, monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(timecode(seconds), w - 56 * scale, h - 26 * scale);
      ctx.textAlign = 'left';

      const whole = Math.floor(seconds);
      if (whole !== reported) {
        reported = whole;
        tick(whole);
      }

      // The film is as long as it needs to be, and no longer.
      if (seconds >= MAX_SECONDS) {
        stop();
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      const localUrl = URL.createObjectURL(blob);
      const seconds = (performance.now() - started) / 1000;
      live.current = null;

      if (blob.size === 0) {
        fail('The recorder produced nothing, so there is no film.');
        return;
      }

      /**
       * Send the film to the cloud.
       *
       * The upload is unsigned, the same way a visitor's photograph is. If
       * the cloud will not take it — an unsigned preset set to images only,
       * say — the film is still worth having, so it is kept and played from
       * this machine, and the reason is said out loud.
       */
      const stamp = Date.now().toString(36);
      if (!uploadsEnabled) {
        finish(
          { localUrl, publicId: null, duration: seconds, bytes: blob.size, uploaded: false },
          `This build has no Cloudinary upload preset, so the film was kept on this machine rather than sent to the cloud. ${configurationRemedy}`,
        );
        return;
      }

      uploadFilm(blob, { publicId: `film-${stamp}`, tags: 'film,bengaluru,recorded' })
        .then((up) =>
          finish(
            {
              localUrl,
              publicId: up.publicId,
              duration: up.duration ?? seconds,
              bytes: up.bytes,
              uploaded: true,
            },
            null,
          ),
        )
        .catch((err: unknown) =>
          finish(
            { localUrl, publicId: null, duration: seconds, bytes: blob.size, uploaded: false },
            `The cloud would not take the film (${err instanceof Error ? err.message : 'unknown reason'}), so it is being played from this machine.`,
          ),
        );
    };

    live.current = { raf: 0, recorder, started, stopped: false };
    const state = live.current;
    state.raf = requestAnimationFrame(draw);

    return () => {
      stop();
    };
  }, [recording, gl, scene, camera, finish, fail, tick]);

  return null;
}
