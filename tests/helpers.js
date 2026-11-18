// Test harness: real MongoDB, real Express app on a random port, cookie-aware HTTP client.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27111';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-1234';
process.env.PIN_PEPPER = process.env.PIN_PEPPER || 'test-pepper-test-pepper-test-pepper-1234';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

const mongoose = require('mongoose');
const { startCloudinaryStub } = require('./cloudinaryStub');

async function boot(dbName) {
  process.env.MONGODB_DB = dbName;
  const cloud = await startCloudinaryStub(); // fake Cloudinary: tests never upload anything for real
  const env = require('../config/env');
  const connectDB = require('../config/db');
  await connectDB(env);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  const server = require('../app')().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return { base, models: mongoose.models, cloud: cloud.calls, stop: async () => { await new Promise((r) => server.close(r)); await cloud.stop(); await mongoose.disconnect(); } };
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, { headers = {}, raw = false } = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'GrowMore', ...(this.cookie && { Cookie: this.cookie }), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const [pair] = c.split(';');
      if (/^gm_token=;/.test(pair) || /Expires=Thu, 01 Jan 1970/.test(c)) this.cookie = '';
      else this.cookie = pair;
    }
    this.lastSetCookie = sc;
    if (raw) return res;
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p); }
}

async function createOwner(pin = '1234') {
  const { User } = mongoose.models;
  const { hashPin } = require('../services/pinService');
  const { ensureDefaults } = require('../services/categoryService');
  const user = await User.create({ pinHash: await hashPin(pin), displayName: 'Owner' });
  await ensureDefaults(user._id);
  return user;
}

async function signedIn(base, pin = '1234') {
  const c = new Client(base);
  const r = await c.post('/auth/login', { pin });
  if (r.status !== 200) throw new Error('login failed in test helper: ' + JSON.stringify(r.data));
  return c;
}

const today = () => require('../utils/dates').todayIn('Asia/Karachi');
module.exports = { boot, Client, createOwner, signedIn, today };
