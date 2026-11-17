import { useEffect, useRef, useState } from 'react';
import type { LandmarkPhoto } from '../data/landmarks';
import {
  CONTRIBUTION_LICENCES,
  contributionsFor,
  rememberContribution,
  uploadContribution,
} from '../cloudinary/contributions';
import { uploadsEnabled } from '../cloudinary/config';

/**
 * Offer a photograph of a landmark.
 *
 * The picture goes straight from the browser to Cloudinary — it never
 * touches this server, and the API secret never comes near the browser. The
 * upload preset is unsigned, so the browser needs no credentials at all.
 *
 * What happens to a contributed photograph afterwards is stated plainly in
 * the form rather than left to be found out: it is published in this
 * landmark's namespace in the cloud, it is credited to whoever offered it,
 * and it stays in this browser's own storage.
 */

/** The largest photograph that will be uploaded. */
const MAX_BYTES = 12 * 1024 * 1024;

export function ContributePhoto({
  slug,
  onUploaded,
}: {
  slug: string;
  onUploaded: (photo: LandmarkPhoto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [license, setLicense] = useState<string>(CONTRIBUTION_LICENCES[0]);
  const [state, setState] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef('');

  // The preview is the chosen file, shown from this machine without ever
  // being uploaded. The object URL is made when the file is chosen and
  // released when it is replaced, so the browser can let go of it.
  const clearPreview = () => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = '';
    }
    setPreview('');
  };

  useEffect(() => clearPreview, []);

  const choose = (f: File | null) => {
    setError('');
    setState('idle');
    clearPreview();
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.type.startsWith('image/')) {
      setFile(null);
      setError('That is not an image file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setError(`That file is ${(f.size / 1048576).toFixed(1)} MB. The limit is 12 MB.`);
      return;
    }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreview(url);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file) return;
    setState('uploading');
    setError('');
    try {
      const result = await uploadContribution(file, {
        slug,
        title: title.trim() || file.name,
        author: author.trim() || 'A visitor',
        license,
      });
      const contribution = {
        publicId: result.publicId,
        title: title.trim() || file.name,
        author: author.trim() || 'A visitor',
        license,
        uploadedAt: new Date().toISOString().slice(0, 10),
        width: result.width,
        height: result.height,
      };
      rememberContribution(slug, contribution);
      onUploaded({
        src: result.publicId,
        publicId: result.publicId,
        commonsUrl: null,
        commonsTitle: contribution.title,
        descriptionUrl: null,
        author: contribution.author,
        credit: 'Offered by a visitor',
        license: contribution.license,
        licenseUrl: null,
        attributionRequired: true,
        angle: 'contributed',
        width: result.width,
        height: result.height,
      });
      setState('done');
      setFile(null);
      clearPreview();
      setTitle('');
      setAuthor('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'The upload did not go through.');
    }
  };

  if (!uploadsEnabled) return null;

  const already = contributionsFor(slug).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="nb-btn nb-btn-ghost mt-3"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        Offer a photograph
        {already > 0 && (
          <span className="ml-1 font-mono text-[10px] tabular-nums text-mist-500">
            {already}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-sm border border-white/10 bg-white/3 p-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="nb-label">Offer a photograph</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="nb-label transition-colors hover:text-mist-100"
          aria-label="Close"
        >
          Close
        </button>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-mist-400">
        The picture is uploaded straight to Cloudinary from your browser. It is
        published under your name and the licence you choose, and it stays in
        this browser&rsquo;s storage on this device.
      </p>

      <div className="mt-3 flex gap-3">
        <label className="relative block h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-white/15 bg-ink-900">
          {preview ? (
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-[10px] text-mist-500">
              Choose
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            aria-label="Choose a photograph"
          />
        </label>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is this a photograph of?"
            aria-label="Photograph title"
            className="w-full rounded-sm border border-white/12 bg-ink-950/60 px-2.5 py-1.5 text-[12px] text-mist-100 outline-none placeholder:text-mist-500 focus:border-saffron/50"
          />
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full rounded-sm border border-white/12 bg-ink-950/60 px-2.5 py-1.5 text-[12px] text-mist-100 outline-none placeholder:text-mist-500 focus:border-saffron/50"
          />
        </div>
      </div>

      <select
        value={license}
        onChange={(e) => setLicense(e.target.value)}
        aria-label="Licence"
        className="mt-2 w-full rounded-sm border border-white/12 bg-ink-950/60 px-2.5 py-1.5 text-[12px] text-mist-100 outline-none focus:border-saffron/50"
      >
        {CONTRIBUTION_LICENCES.map((l) => (
          <option key={l} value={l} className="bg-ink-900">
            {l}
          </option>
        ))}
      </select>

      {error && (
        <p className="mt-2 text-[11px] leading-relaxed text-red-300/90">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!file || state === 'uploading'}
          className="nb-btn nb-btn-primary disabled:cursor-not-allowed disabled:opacity-45"
        >
          {state === 'uploading' ? 'Uploading…' : 'Upload'}
        </button>
        {state === 'done' && (
          <span className="text-[11px] text-saffron/85">Uploaded. Thank you.</span>
        )}
      </div>
    </div>
  );
}
