/**
 * Cloudinary configuration.
 *
 * The browser only ever sees the *cloud name* — delivery URLs are public by
 * design. The API secret is used exclusively by the server-side upload
 * script (`scripts/upload-cloudinary.mjs`), which reads it from the
 * environment and never ships it to the client.
 *
 * Environment variables:
 *   VITE_CLOUDINARY_CLOUD_NAME  — the Cloudinary cloud name (public)
 *   VITE_CLOUDINARY_UPLOAD_PRESET — the unsigned upload preset (public)
 *   CLOUDINARY_API_KEY         — server-side only, never exposed to the app
 *   CLOUDINARY_API_SECRET      — server-side only, never exposed to the app
 */

export interface CloudinaryConfig {
  cloudName: string;
  /** Folder all public IDs live under. */
  root: string;
  /** True when a cloud name is configured and remote delivery can be used. */
  enabled: boolean;
}

const CLOUD_NAME = (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ?? '').trim();

export const config: CloudinaryConfig = {
  cloudName: CLOUD_NAME,
  root: 'bengaluru',
  enabled: CLOUD_NAME.length > 0,
};

/**
 * The unsigned upload preset, when one is configured.
 *
 * An unsigned preset is public by design: the preset name *is* the
 * permission, so it is meant to be in the browser. It is not a secret, and
 * it grants nothing beyond what its own settings allow.
 */
export const uploadPreset: string = (
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ?? ''
).trim();

/** True when a visitor can upload a photograph from the browser. */
export const uploadsEnabled: boolean = config.enabled && uploadPreset.length > 0;

/**
 * What is missing, if anything.
 *
 * The photographs and the films of the city are delivered from addresses
 * that are written into the source, and they work as long as the cloud name
 * is there. The postcard is the one thing in the app that *writes* to the
 * cloud, and so it is the one thing that can be unconfigured: the browser
 * needs an unsigned upload preset, and the name of that preset is the
 * permission.
 *
 * So when a postcard cannot be sent, the first thing to say is which of the
 * two settings is absent — because that is the thing somebody has to go and
 * set, and a message that does not name it is a message that cannot be
 * acted on.
 */
export const configurationProblem: string | null = !config.enabled
  ? 'VITE_CLOUDINARY_CLOUD_NAME is not set, so the app does not know which cloud to talk to.'
  : uploadPreset.length === 0
    ? 'VITE_CLOUDINARY_UPLOAD_PRESET is not set, so the browser has been given no permission to upload.'
    : null;

/**
 * What to do about a build that cannot upload.
 *
 * The name of the preset is the permission — it is public by design, and it
 * is not a secret. The API secret is never needed here, and never ships.
 *
 * It belongs in two places: in the `.env` file beside the app, for the dev
 * server, and as a repository secret, for the build that is published.
 */
export const configurationRemedy =
  'Put it in the .env file beside the app for the dev server, and as the VITE_CLOUDINARY_UPLOAD_PRESET repository secret for the published site, and then restart or rebuild.';

/** The public delivery base for this cloud. */
export function deliveryBase(): string {
  return `https://res.cloudinary.com/${config.cloudName}/image/upload`;
}

/** The public video delivery base for this cloud. */
export function videoDeliveryBase(): string {
  return `https://res.cloudinary.com/${config.cloudName}/video/upload`;
}

/** The public raw delivery base for this cloud. */
export function rawDeliveryBase(): string {
  return `https://res.cloudinary.com/${config.cloudName}/raw/upload`;
}

/** The public upload endpoint used by the server-side upload script. */
export function uploadEndpoint(): string {
  return `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`;
}
