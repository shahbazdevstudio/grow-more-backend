// A tiny fake of Cloudinary's upload/destroy API, so tests never touch the real service.
const http = require('http');
const crypto = require('crypto');

const SECRET = 'test-secret';
const field = (text, name) => { const m = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`)); return m ? m[1] : undefined; };

async function startCloudinaryStub() {
  const calls = { uploads: [], destroys: [] };
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('latin1');
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const okSig = (names) => {
        const base = names.filter((k) => field(text, k) !== undefined).sort().map((k) => `${k}=${field(text, k)}`).join('&');
        return crypto.createHash('sha1').update(base + SECRET).digest('hex') === field(text, 'signature') && field(text, 'api_key') === 'test-key';
      };
      if (req.url === '/v1_1/test-cloud/image/upload' && req.method === 'POST') {
        if (!okSig(['folder', 'timestamp'])) return send(401, { error: { message: 'Invalid Signature' } });
        const file = field(text, 'file') || '';
        if (!file.startsWith('data:image/')) return send(400, { error: { message: 'Invalid image file' } });
        if (file.includes('RkFJTE1F')) return send(500, { error: { message: 'boom' } }); // base64 of FAILME: simulates an outage
        n += 1;
        const publicId = `${field(text, 'folder')}/img${n}`;
        calls.uploads.push({ folder: field(text, 'folder'), publicId, file });
        return send(200, { public_id: publicId, secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.webp` });
      }
      if (req.url === '/v1_1/test-cloud/image/destroy' && req.method === 'POST') {
        if (!okSig(['public_id', 'timestamp', 'invalidate'])) return send(401, { error: { message: 'Invalid Signature' } });
        calls.destroys.push(field(text, 'public_id'));
        return send(200, { result: 'ok' });
      }
      send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: SECRET,
    CLOUDINARY_FOLDER: 'growmore', CLOUDINARY_API_BASE: `http://127.0.0.1:${port}/v1_1`,
  });
  return { calls, stop: () => new Promise((r) => server.close(r)) };
}
module.exports = { startCloudinaryStub };
