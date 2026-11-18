/**
 * Image storage on Cloudinary. Images never live in MongoDB or on the server's disk (Vercel has no persistent disk):
 * the browser sends one small, resized image as a data URI, we upload it to Cloudinary and keep ONLY its https URL
 * (plus the Cloudinary public id, server-side, so the file can be removed when it is replaced or deleted).
 *
 * Uses Cloudinary's signed REST API with Node's built-in fetch/crypto - no extra dependency.
 */
const crypto = require('crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const cfg = () => env.cloudinary;
const isConfigured = () => !!(cfg().cloudName && cfg().apiKey && cfg().apiSecret);

/** Cloudinary signature: SHA-1 of "k=v&k=v" (keys sorted, empty values dropped) followed directly by the API secret. */
function sign(params) {
  const base = Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined && params[k] !== null).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(base + cfg().apiSecret).digest('hex');
}

const urlPrefix = () => `https://res.cloudinary.com/${cfg().cloudName}/`;
const isOurUrl = (s) => typeof s === 'string' && !!cfg().cloudName && s.startsWith(urlPrefix()) && s.length <= 600;

function requireConfigured() {
  if (!isConfigured()) throw new ApiError(503, 'Image storage is not set up on the server (Cloudinary keys are missing).', 'IMAGE_STORAGE');
}

async function call(endpoint, fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.append(k, v));
  let res;
  try {
    res = await fetch(`${cfg().apiBase}/${cfg().cloudName}/image/${endpoint}`, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    console.error('[images] Cloudinary unreachable:', e && e.message);
    throw new ApiError(502, 'Could not reach the image service. Please try again.', 'IMAGE_UPLOAD');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/** Uploads a data URI into <folder>/<sub>. Returns { url, publicId }. */
async function upload(dataUri, sub) {
  requireConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${cfg().folder}/${sub}`;
  const { ok, status, data } = await call('upload', { file: dataUri, api_key: cfg().apiKey, timestamp: String(timestamp), folder, signature: sign({ folder, timestamp }) });
  if (!ok || !data || !data.secure_url || !data.public_id) {
    console.error('[images] Cloudinary upload failed:', status, data && data.error && data.error.message);
    throw new ApiError(502, 'The image could not be saved. Please try again, or use a different image.', 'IMAGE_UPLOAD');
  }
  return { url: data.secure_url, publicId: data.public_id };
}

/** Best-effort delete. Never throws: a leftover file on Cloudinary must not break saving or deleting a record. */
async function destroy(publicId) {
  if (!publicId || !isConfigured()) return false;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const { ok, data } = await call('destroy', { public_id: publicId, api_key: cfg().apiKey, timestamp: String(timestamp), invalidate: 'true', signature: sign({ public_id: publicId, timestamp, invalidate: 'true' }) });
    return ok && !!data && (data.result === 'ok' || data.result === 'not found');
  } catch { return false; }
}

/**
 * Resolves the image field a client sent into what must be stored.
 *   incoming: '' (no image) | data URI (new upload) | our own Cloudinary URL (unchanged - only valid on edit)
 *   current:  { url, publicId } already stored on the record (omit on create)
 * Returns { url, publicId, commit(), rollback() }:
 *   call commit()   after the record was saved   -> removes the replaced/removed old file
 *   call rollback() if saving the record failed  -> removes the file we just uploaded
 */
async function prepare(incoming, { sub, current = null }) {
  const stale = current && current.publicId ? current.publicId : '';
  let out;
  if (!incoming) out = { url: '', publicId: '', uploaded: '', drop: stale };
  else if (incoming.startsWith('data:image/')) {
    const up = await upload(incoming, sub);
    out = { url: up.url, publicId: up.publicId, uploaded: up.publicId, drop: stale };
  } else if (current && current.url === incoming) out = { url: current.url, publicId: current.publicId || '', uploaded: '', drop: '' };
  else throw new ApiError(400, 'That image is not valid. Choose the picture again.', 'VALIDATION');
  return {
    url: out.url,
    publicId: out.publicId,
    commit: () => destroy(out.drop),
    rollback: () => destroy(out.uploaded),
  };
}

module.exports = { upload, destroy, prepare, sign, isConfigured, isOurUrl };
