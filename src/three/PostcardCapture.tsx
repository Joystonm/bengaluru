import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { usePostcard } from '../state/postcardStore';
import { useApp } from '../state/store';
import { uploadPostcard } from '../cloudinary/postcard';

/**
 * The postcard capture.
 *
 * This lives inside the 3D canvas because what it photographs is the canvas.
 * There is no screen grab and no export button: the city is drawn again,
 * and the frame it draws is read back out of the drawing buffer as the
 * picture the visitor was looking at.
 *
 * The read happens inside an animation frame, immediately after the scene
 * has been rendered inside that same frame. A WebGL drawing buffer is
 * cleared once it has been shown, so reading it at an arbitrary moment can
 * return nothing at all — and a postcard of an empty city would be a poor
 * thing to send anybody.
 *
 * The frame then goes to the cloud on its own, without a key or a secret,
 * and the visitor keeps a copy here as well: if the cloud will not take the
 * picture, the picture is still theirs.
 */

/** The frame is read as a JPEG of this quality. */
const JPEG_QUALITY = 0.9;

/** The caption a postcard carries when the visitor has not written one. */
const DEFAULT_CAPTION = 'Namma Bengaluru';

/**
 * Turn a data URL into the bytes it stands for.
 *
 * The base64 is decoded by hand rather than fetched, so that the picture
 * never leaves the machine on the way to becoming a file.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = comma > 0 ? dataUrl.slice(0, comma) : '';
  const base64 = comma > 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const mime = /data:([^;,]+)/.exec(header)?.[1] ?? 'image/jpeg';
  return new Blob([bytes], { type: mime });
}

/**
 * Ask the canvas for the same picture, as a file.
 *
 * Some browsers will not hand the canvas over as a data URL; most of them
 * will still write it out as a blob. This is the second way of asking.
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

export function PostcardCapture() {
  const { gl, scene, camera } = useThree();
  const status = usePostcard((s) => s.status);

  /**
   * Whether this request has already been answered.
   *
   * One request must be one frame, however many times the component is
   * asked to draw itself.
   */
  const taken = useRef(false);

  useEffect(() => {
    // A postcard put away makes room for the next one. The guard is released
    // here and nowhere else, so that a request in flight cannot take two
    // frames.
    if (status === 'idle') {
      taken.current = false;
      return;
    }
    if (status !== 'capturing') return;
    if (taken.current) return;

    let cancelled = false;

    /**
     * Take the frame and send it.
     */
    const capture = async () => {
      const canvas = gl.domElement;

      let blob: Blob | null = null;

      try {
        // Draw the city again, so that the buffer being read is known to
        // hold a picture of it.
        gl.render(scene, camera);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        if (dataUrl) blob = dataUrlToBlob(dataUrl);
      } catch {
        blob = null;
      }

      // The second way of asking the same canvas for the same picture.
      if (!blob) blob = await canvasToBlob(canvas);

      if (cancelled) return;

      if (!blob || blob.size === 0) {
        usePostcard
          .getState()
          .fail(
            'This browser would not hand over the picture of the city, so there is no postcard to send.',
          );
        return;
      }

      // The picture is kept on this machine as well, so that the visitor
      // still has their own frame even if the cloud turns it away.
      const localUrl = URL.createObjectURL(blob);

      const postcard = usePostcard.getState();
      const city = useApp.getState();

      postcard.uploading();

      try {
        const upload = await uploadPostcard(blob, {
          caption: postcard.caption.trim() || DEFAULT_CAPTION,
          landmark: city.selectedId,
          timeOfDay: city.timeOfDay,
          weather: city.weather,
          festival: city.festival,
        });
        usePostcard.getState().ready(upload.publicId, localUrl, upload.autoTags);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : 'the cloud would not say why';
        usePostcard.getState().fail(`The postcard did not reach the cloud: ${reason}.`);
        // The frame itself was taken, and it is still here — the failure is
        // about the cloud, not about the picture.
        usePostcard.setState({ localUrl });
      }
    };

    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      // The guard is set here rather than above, so that a request which is
      // mounted twice over — as it is in development — still takes exactly
      // one frame, and only one.
      if (taken.current) return;
      taken.current = true;
      void capture();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [status, gl, scene, camera]);

  return null;
}
