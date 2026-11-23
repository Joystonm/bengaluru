/**
 * Photographs contributed by visitors.
 *
 * A visitor can offer a photograph of a landmark from inside the app. It is
 * uploaded straight to Cloudinary with the unsigned upload preset — no file
 * ever passes through this server, and the API secret never comes near the
 * browser.
 *
 * The uploaded photograph lands in its own namespace,
 * `bengaluru/contributions/<landmark>/…`, so it is never mistaken for one of
 * the Wikimedia Commons photographs, and it is tagged so that it can be told
 * apart in the Media Library too.
 *
 * Where the photographs are kept: the browser's own storage, per landmark.
 * They are the visitor's own contributions, on the visitor's own machine;
 * the cloud holds the picture, this holds the list.
 */

import {
  config,
  configurationProblem,
  configurationRemedy,
  uploadPreset,
  uploadsEnabled,
} from './config';
import { noteUse } from './usage';

/** A photograph a visitor has offered. */
export interface Contribution {
  /** The Cloudinary public ID the photograph was given. */
  publicId: string;
  /** The name the visitor gave the photograph. */
  title: string;
  /** The name the visitor gave themselves. */
  author: string;
  /** The licence the visitor is offering it under. */
  license: string;
  /** When it was uploaded, as an ISO date. */
  uploadedAt: string;
  width: number | null;
  height: number | null;
}

const STORE_KEY = 'nb.contributions';

/** Every contribution this browser holds, across all landmarks. */
export function allContributions(): Record<string, Contribution[]> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Contribution[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** The contributions held for one landmark. */
export function contributionsFor(slug: string): Contribution[] {
  return allContributions()[slug] ?? [];
}

/** Remember a contribution on this machine. */
export function rememberContribution(slug: string, contribution: Contribution): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const all = allContributions();
    all[slug] = [...(all[slug] ?? []), contribution];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // A full or disabled storage is not a reason to lose the photograph.
  }
}

/** The result of an upload, as Cloudinary reports it. */
export interface UploadResult {
  publicId: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

/**
 * Upload one photograph to the cloud.
 *
 * The upload is unsigned: the preset name is the permission, so the browser
 * needs no key and no secret. Cloudinary accepts `folder`, `public_id`,
 * `tags` and `context` on an unsigned upload — and refuses everything else,
 * which is why this sends nothing else.
 */
export async function uploadContribution(
  file: File,
  options: { slug: string; title: string; author: string; license: string },
): Promise<UploadResult> {
  if (!uploadsEnabled) {
    throw new Error(
      `${configurationProblem ?? 'Uploading is not configured for this cloud.'} ${configurationRemedy}`,
    );
  }

  const body = new FormData();
  body.append('file', file);
  body.append('upload_preset', uploadPreset);
  body.append('folder', `${config.root}/contributions/${options.slug}`);
  // A timestamp and a few random characters, so two visitors offering a
  // photograph at the same moment cannot collide on one public ID.
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 8);
  body.append('public_id', `${stamp}-${salt}`);
  body.append('tags', `contribution,landmark:${options.slug}`);
  noteUse('upload');
  noteUse('context');
  body.append(
    'context',
    [
      `author=${options.author}`,
      `license=${options.license}`,
      `source=Visitor contribution`,
      `title=${options.title}`,
    ]
      .map((s) => s.replace(/[|=]/g, ' '))
      .join('|'),
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    { method: 'POST', body },
  );

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`The upload could not be read (${res.status}).`);
  }

  if (!res.ok) {
    const detail =
      (json.error as { message?: string } | undefined)?.message ?? text.slice(0, 200);
    throw new Error(detail || `The upload was refused (${res.status}).`);
  }

  return {
    publicId: String(json.public_id ?? ''),
    width: typeof json.width === 'number' ? json.width : null,
    height: typeof json.height === 'number' ? json.height : null,
    bytes: typeof json.bytes === 'number' ? json.bytes : 0,
  };
}

/** The licences a visitor can offer a photograph under. */
export const CONTRIBUTION_LICENCES = [
  'CC0 1.0 (public domain dedication)',
  'CC BY 4.0',
  'CC BY-SA 4.0',
  'I own the rights and give permission to publish it here',
] as const;
