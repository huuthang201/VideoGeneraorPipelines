import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import { exec } from '../utils/exec';

/**
 * Uploading a finished video to YouTube.
 *
 * Written against the REST endpoints with `fetch` rather than the `googleapis`
 * package. That package is excellent and enormous - a hundred-odd megabytes of
 * generated clients for services this project will never touch - to obtain what
 * amounts to three HTTP calls: swap a code for a token, start a resumable
 * session, push the bytes.
 *
 * ## What this cannot do, and why
 *
 * Videos uploaded through an API project that has not passed Google's
 * compliance audit are forced to `private`, whatever `status.privacyStatus`
 * asks for. That is not a bug in this code and not something a flag can defeat:
 * it applies to every project created since July 2020 until it is audited. The
 * upload still saves the tedious part - the file, the title, the description
 * with its hashtags - and leaves one switch to flip in YouTube Studio.
 *
 * Nothing here says "Short". YouTube decides that itself, from the frame being
 * vertical and the video being under sixty seconds, which is why both of those
 * are enforced upstream in configuration and in the word budget rather than
 * requested here.
 *
 * `PRIVACY_NOTE` is reported back to the caller so the person who pressed the
 * button is told this rather than discovering it on the channel.
 */

export const PRIVACY_NOTE =
  'Google forces uploads from unaudited API projects to "private". Flip the video to ' +
  'public or unlisted in YouTube Studio, or apply for the API compliance audit.';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  // Needed only for the cover image; harmless when the channel cannot use it.
  'https://www.googleapis.com/auth/youtube',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAIL_ENDPOINT = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

/**
 * Bytes per PUT.
 *
 * Must be a multiple of 256 KiB - the API rejects a chunk that is not, except
 * for the final one. 8 MiB is large enough that a 120 MB episode is fifteen
 * requests rather than five hundred, and small enough that a dropped connection
 * costs seconds rather than the whole upload.
 */
const CHUNK_SIZE = 8 * 1024 * 1024;

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
  /** Where the refresh token lives. Inside runtime/, which is gitignored. */
  tokenPath: string;
  /** Loopback port consent returns on. Must match what Google has registered. */
  redirectPort?: number;
}

/** Used when nothing is configured; see YOUTUBE_REDIRECT_PORT. */
export const DEFAULT_REDIRECT_PORT = 4180;

/** The URI Google must be willing to redirect to. Printed, and pasteable. */
export function redirectUriFor(port: number = DEFAULT_REDIRECT_PORT): string {
  return `http://localhost:${port}`;
}

export interface VideoMeta {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  /** BCP-47, e.g. "vi". Sets both the audio and the metadata language. */
  language: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  /**
   * ISO timestamp to go public at, or null to publish on upload.
   *
   * YouTube requires the video to be private for this to be accepted, which
   * `uploadVideo` enforces rather than letting the API reject the whole upload
   * over a combination the caller probably did not mean.
   */
  publishAt?: string | null;
}

export interface UploadResult {
  videoId: string;
  url: string;
  /** Echoed back so the caller can record what was actually asked for. */
  publishAt: string | null;
  /** The channel it actually landed on. */
  channel: ChannelInfo | null;
  /** What YouTube actually set, which may not be what was asked for. */
  privacyStatus: string;
  thumbnailSet: boolean;
  thumbnailError: string | null;
}

interface StoredToken {
  refreshToken: string;
  obtainedAt: string;
  /** Which channel this token uploads to. Recorded at consent time. */
  channel?: ChannelInfo;
}

export interface ChannelInfo {
  id: string;
  title: string;
  /** The @handle, when the channel has one. */
  handle: string | null;
  url: string;
}

/**
 * One-time consent, through the loopback flow.
 *
 * The loopback (rather than a pasted code) because Google has deprecated the
 * out-of-band copy-paste flow, and because a temporary server on localhost is
 * the difference between "click allow" and "find the code in the URL bar".
 *
 * PKCE is used even though this is a confidential client with a secret: the
 * secret sits in a .env on a laptop, so treating the exchange as public costs
 * nothing and removes one way for a local process to hijack the code.
 */
export async function authorize(
  credentials: YouTubeCredentials,
  onMessage: (message: string) => void,
): Promise<void> {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const port = credentials.redirectPort ?? DEFAULT_REDIRECT_PORT;
  const redirectUri = redirectUriFor(port);

  const server = createServer();
  server.listen(port, 'localhost');

  try {
    await once(server, 'listening');
  } catch (err) {
    server.close();
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      `Could not listen on ${redirectUri} (${err instanceof Error ? err.message : String(err)}). ` +
        'Something else is using that port - set YOUTUBE_REDIRECT_PORT to a free one, and ' +
        'register the matching URI in Google Cloud Console.',
    );
  }
  const authUrl =
    `${AUTH_ENDPOINT}?` +
    new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      // Without these two Google returns no refresh token on a repeat consent,
      // and the next run would send the user back to the browser.
      access_type: 'offline',
      /*
       * `select_account` as well as `consent`, and the account half matters as
       * much as the consent half.
       *
       * With `consent` alone Google silently uses whichever account the browser
       * happens to be signed into. On a machine with two Google accounts - a
       * personal one and the one that owns the channel - that is how consent
       * gets granted from the wrong account, which then fails as "not a test
       * user" or, worse, succeeds and uploads to the wrong channel. Forcing the
       * chooser costs one click and removes the guess.
       */
      prompt: 'consent select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

  onMessage(`Redirect URI in use: ${redirectUri}`);
  onMessage(
    'If Google says "redirect_uri_mismatch": the OAuth client is a *Web application*, so this ' +
      'exact URI has to be listed under "Authorized redirect URIs" - or create the client as ' +
      '"Desktop app" instead, where any loopback port is accepted.',
  );
  onMessage(`Opening the browser. If nothing happens, visit:\n${authUrl}`);
  await exec('open', [authUrl]).catch(() => {
    /* Not macOS, or no browser: the URL was printed above. */
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No response within 5 minutes')), 300_000);

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      const returned = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      const done = (message: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:system-ui;padding:3rem">${message}</body></html>`);
      };

      if (url.searchParams.get('state') !== state) {
        done('State mismatch - close this and try again.');
        return;
      }
      if (error || !returned) {
        done(`Authorisation failed: ${error ?? 'no code returned'}`);
        clearTimeout(timeout);
        reject(new Error(error ?? 'no code returned'));
        return;
      }

      done('Done. You can close this tab and go back to the terminal.');
      clearTimeout(timeout);
      resolve(returned);
    });
  }).finally(() => server.close());

  const token = await postForm(TOKEN_ENDPOINT, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  if (!token.refresh_token) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      'Google returned no refresh token. Remove this app from ' +
        'https://myaccount.google.com/permissions and authorise again.',
    );
  }

  /*
   * Which channel did they just pick?
   *
   * Nothing in the upload call names a channel - `videos.insert` always uploads
   * to whichever channel the credentials belong to, chosen on Google's consent
   * screen and invisible afterwards. On an account with a personal channel and
   * two brand channels that is a genuinely easy thing to get wrong, and the
   * only way to discover the mistake is to find the episode on the wrong
   * channel. So the answer is fetched once, here, and kept beside the token.
   */
  const channel = await fetchChannel(token.access_token as string);

  const stored: StoredToken = {
    refreshToken: token.refresh_token as string,
    obtainedAt: new Date().toISOString(),
    channel: channel ?? undefined,
  };
  await writeFile(credentials.tokenPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

  onMessage(
    channel
      ? `Authorised for channel: ${channel.title}${channel.handle ? ` (${channel.handle})` : ''}`
      : 'Authorised, but this account has no YouTube channel yet - create one before uploading.',
  );
  onMessage(`Token stored in ${credentials.tokenPath}`);
}

/**
 * The channel a set of credentials belongs to.
 *
 * `mine=true` is the only way to ask: there is no "which channel am I?"
 * parameter on the upload itself.
 */
export async function fetchChannel(accessTokenValue: string): Promise<ChannelInfo | null> {
  const response = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { authorization: `Bearer ${accessTokenValue}` } },
  );

  if (!response.ok) return null;

  const body = (await response.json()) as {
    items?: { id: string; snippet: { title: string; customUrl?: string } }[];
  };
  const item = body.items?.[0];
  if (!item) return null;

  return {
    id: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl ?? null,
    url: item.snippet.customUrl
      ? `https://www.youtube.com/${item.snippet.customUrl}`
      : `https://www.youtube.com/channel/${item.id}`,
  };
}

/** The channel recorded at consent time, without spending a request. */
export async function storedChannel(credentials: YouTubeCredentials): Promise<ChannelInfo | null> {
  const raw = await readFile(credentials.tokenPath, 'utf8').catch(() => null);
  if (!raw) return null;

  try {
    return (JSON.parse(raw) as StoredToken).channel ?? null;
  } catch {
    return null;
  }
}

/**
 * A live check that the stored credentials still work.
 *
 * Worth having as its own call because the failure it catches is silent and
 * time-delayed: an OAuth consent screen left in "Testing" expires its refresh
 * tokens after seven days, so credentials that authorised perfectly last week
 * fail at the first upload - after the render, at the worst moment. Asking who
 * we are costs one request and answers it now.
 */
export async function verifyCredentials(
  credentials: YouTubeCredentials,
): Promise<ChannelInfo | null> {
  return fetchChannel(await accessToken(credentials));
}

/**
 * How old a refresh token is, in days, or null when none is stored.
 *
 * Exists for one narrow reason: a consent screen left in "Testing" expires its
 * refresh token after seven days, and the failure is invisible until an upload
 * tries and is refused. On a channel publishing hourly and unattended, that is
 * a day of nothing going out before anybody notices - so the age is checked
 * before each upload and reported while there is still time to act.
 *
 * Age is all this can know. The API does not expose the project's publishing
 * status, so a warning cannot tell whether the seven-day rule even applies; it
 * says so rather than guessing.
 */
export async function tokenAgeDays(credentials: YouTubeCredentials): Promise<number | null> {
  const raw = await readFile(credentials.tokenPath, 'utf8').catch(() => null);
  if (!raw) return null;

  try {
    const obtainedAt = new Date((JSON.parse(raw) as StoredToken).obtainedAt).getTime();
    if (Number.isNaN(obtainedAt)) return null;
    return (Date.now() - obtainedAt) / 86_400_000;
  } catch {
    return null;
  }
}

/**
 * Days after which a token in a "Testing" project is worth warning about.
 *
 * Five, not seven: a warning that arrives on the day the token dies is a
 * notification, not a warning. Two days is enough to re-run consent before the
 * queue is affected.
 */
export const TOKEN_WARN_DAYS = 5;

/** Google's hard expiry for a refresh token issued by a Testing project. */
export const TESTING_TOKEN_EXPIRY_DAYS = 7;

/** A short-lived access token, from the stored refresh token. */
async function accessToken(credentials: YouTubeCredentials): Promise<string> {
  const raw = await readFile(credentials.tokenPath, 'utf8').catch(() => null);
  if (!raw) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      'Not authorised yet. Run: npx tsx src/cli/index.ts youtube-auth',
    );
  }

  const { refreshToken } = JSON.parse(raw) as StoredToken;
  const token = await postForm(TOKEN_ENDPOINT, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  if (!token.access_token) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      'Could not refresh the Google token. Consent may have been revoked, or the OAuth ' +
        'consent screen is still in Testing mode, where refresh tokens expire after 7 days. ' +
        'Run youtube-auth again.',
    );
  }

  return token.access_token as string;
}

export async function uploadVideo(
  credentials: YouTubeCredentials,
  input: {
    videoPath: string;
    thumbnailPath?: string | null;
    meta: VideoMeta;
    onProgress?: (uploaded: number, total: number) => void;
    onMessage?: (message: string) => void;
  },
): Promise<UploadResult> {
  const token = await accessToken(credentials);
  const channel = await fetchChannel(token);
  const { size } = await stat(input.videoPath);

  if (channel) input.onMessage?.(`Uploading to channel: ${channel.title}`);

  // 1. Open a resumable session. The metadata goes here, not with the bytes.
  const start = await fetch(
    `${UPLOAD_ENDPOINT}?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: input.meta.title,
          description: input.meta.description,
          tags: input.meta.tags,
          categoryId: input.meta.categoryId,
          defaultLanguage: input.meta.language,
          defaultAudioLanguage: input.meta.language,
        },
        status: {
          // A scheduled video must be uploaded private; YouTube flips it at
          // publishAt. Sending "public" with a publishAt is rejected outright.
          privacyStatus: input.meta.publishAt ? 'private' : input.meta.privacyStatus,
          ...(input.meta.publishAt ? { publishAt: input.meta.publishAt } : {}),
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!start.ok) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      `YouTube refused the upload session (${start.status}): ${(await start.text()).slice(0, 400)}`,
    );
  }

  const sessionUrl = start.headers.get('location');
  if (!sessionUrl) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      'YouTube accepted the request but returned no upload session URL.',
    );
  }

  // 2. Push the file in chunks, so a 120MB episode reports progress and a
  //    dropped connection does not restart from zero.
  const handle = await open(input.videoPath, 'r');
  let uploaded = 0;
  let videoId = '';
  let privacyStatus = input.meta.privacyStatus;

  try {
    while (uploaded < size) {
      const length = Math.min(CHUNK_SIZE, size - uploaded);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, uploaded);

      const end = uploaded + length - 1;
      const response = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'content-length': String(length),
          'content-range': `bytes ${uploaded}-${end}/${size}`,
        },
        body: new Uint8Array(buffer),
      });

      // 308 means "chunk stored, send the next one" - the normal case, and not
      // an error however much the number looks like one.
      if (response.status === 308) {
        uploaded += length;
        input.onProgress?.(uploaded, size);
        continue;
      }

      if (response.ok) {
        const body = (await response.json()) as {
          id?: string;
          status?: { privacyStatus?: string };
        };
        uploaded += length;
        input.onProgress?.(uploaded, size);
        videoId = body.id ?? '';
        privacyStatus = (body.status?.privacyStatus as VideoMeta['privacyStatus']) ?? privacyStatus;
        break;
      }

      throw new PipelineError(
        ERROR_CODES.AI_CALL_FAILED,
        'publish',
        `Upload failed at ${Math.round((uploaded / size) * 100)}% (${response.status}): ` +
          `${(await response.text()).slice(0, 300)}`,
      );
    }
  } finally {
    await handle.close();
  }

  if (!videoId) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      'Upload finished but YouTube returned no video id.',
    );
  }

  // 3. The cover image, which is a separate call and a separate privilege.
  let thumbnailSet = false;
  let thumbnailError: string | null = null;

  if (input.thumbnailPath) {
    const result = await setThumbnail(token, videoId, input.thumbnailPath);
    thumbnailSet = result.ok;
    thumbnailError = result.error;
    if (result.error) input.onMessage?.(`Thumbnail not set: ${result.error}`);
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    publishAt: input.meta.publishAt ?? null,
    channel,
    privacyStatus,
    thumbnailSet,
    thumbnailError,
  };
}

/**
 * Sets the cover image.
 *
 * Failure here is reported, never thrown: setting a custom thumbnail requires a
 * channel that has been verified by phone, and a hundred-megabyte upload that
 * succeeded must not be reported as a failure because of the picture on it.
 */
async function setThumbnail(
  token: string,
  videoId: string,
  thumbnailPath: string,
): Promise<{ ok: boolean; error: string | null }> {
  const body = await readFile(thumbnailPath).catch(() => null);
  if (!body) return { ok: false, error: `could not read ${path.basename(thumbnailPath)}` };

  const response = await fetch(`${THUMBNAIL_ENDPOINT}?videoId=${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body: new Uint8Array(body),
  });

  if (response.ok) return { ok: true, error: null };

  const detail = (await response.text()).slice(0, 200);
  return {
    ok: false,
    error:
      response.status === 403
        ? 'the channel is not verified for custom thumbnails (verify it by phone in YouTube Studio)'
        : `${response.status} ${detail}`,
  };
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'publish',
      `Google returned ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`,
    );
  }
  return payload;
}
