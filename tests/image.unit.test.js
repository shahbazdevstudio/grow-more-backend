// Cloudinary image storage - no database needed.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27111';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.PIN_PEPPER = 'test-pepper-test-pepper-test-pepper-1234';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startCloudinaryStub } = require('./cloudinaryStub');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
let stub; let images; let accountV; let darazV;

test.before(async () => {
  stub = await startCloudinaryStub();
  images = require('../services/imageService');
  accountV = require('../validators/account.validator');
  darazV = require('../validators/daraz.validator');
});
test.after(() => stub.stop());

test('upload: signed request accepted, URL + public id returned, goes into the right folder', async () => {
  const r = await images.upload(PNG, 'accounts');
  assert.match(r.url, /^https:\/\/res\.cloudinary\.com\/test-cloud\//);
  assert.equal(r.publicId, 'growmore/accounts/img1');
  assert.equal(stub.calls.uploads[0].folder, 'growmore/accounts');
});

test('upload: a Cloudinary failure becomes a clean 502, not a crash', async () => {
  await assert.rejects(() => images.upload('data:image/png;base64,RkFJTE1F', 'accounts'), (e) => e.status === 502 && e.code === 'IMAGE_UPLOAD');
});

test('destroy: signed delete reaches Cloudinary and never throws', async () => {
  assert.equal(await images.destroy('growmore/accounts/img1'), true);
  assert.deepEqual(stub.calls.destroys, ['growmore/accounts/img1']);
  assert.equal(await images.destroy(''), false);
});

test('prepare: create / keep / replace / remove / invalid', async () => {
  // new upload
  const a = await images.prepare(PNG, { sub: 'products' });
  assert.ok(a.url.startsWith('https://res.cloudinary.com/test-cloud/') && a.publicId);
  const cur = { url: a.url, publicId: a.publicId };
  // unchanged on edit -> nothing uploaded, nothing deleted
  const before = stub.calls.uploads.length; const dBefore = stub.calls.destroys.length;
  const keep = await images.prepare(a.url, { sub: 'products', current: cur });
  assert.equal(keep.url, a.url); await keep.commit();
  assert.equal(stub.calls.uploads.length, before); assert.equal(stub.calls.destroys.length, dBefore);
  // replaced -> old file removed only on commit
  const rep = await images.prepare(PNG, { sub: 'products', current: cur });
  assert.notEqual(rep.publicId, a.publicId); assert.equal(stub.calls.destroys.length, dBefore);
  await rep.commit(); assert.equal(stub.calls.destroys.at(-1), a.publicId);
  // save failed -> the NEW file is removed, the old one stays
  const rb = await images.prepare(PNG, { sub: 'products', current: { url: rep.url, publicId: rep.publicId } });
  await rb.rollback(); assert.equal(stub.calls.destroys.at(-1), rb.publicId);
  // removed
  const gone = await images.prepare('', { sub: 'products', current: { url: rep.url, publicId: rep.publicId } });
  assert.equal(gone.url, ''); await gone.commit(); assert.equal(stub.calls.destroys.at(-1), rep.publicId);
  // a URL that is not the stored one is refused
  await assert.rejects(() => images.prepare('https://res.cloudinary.com/test-cloud/other.png', { sub: 'products', current: cur }), (e) => e.status === 400);
  await assert.rejects(() => images.prepare('https://res.cloudinary.com/test-cloud/other.png', { sub: 'products' }), (e) => e.status === 400);
});

test('validators: data URI or our own Cloudinary URL only', () => {
  const ok = 'https://res.cloudinary.com/test-cloud/image/upload/v1/growmore/accounts/x.webp';
  assert.equal(accountV.parseAccount({ name: 'A', type: 'bank', logoData: ok }).logoData, ok);
  assert.equal(accountV.parseAccount({ name: 'A', type: 'bank', logoData: PNG }).logoData, PNG);
  assert.equal(accountV.parseAccount({ name: 'A', type: 'bank' }).logoData, '');
  for (const bad of ['<script>alert(1)</script>', 'https://evil.example/x.png', 'https://res.cloudinary.com/someone-else/x.png', 'data:image/svg+xml;base64,AAAA', 'javascript:alert(1)']) {
    assert.throws(() => accountV.parseAccount({ name: 'A', type: 'bank', logoData: bad }), (e) => e.status === 400, bad);
    assert.throws(() => darazV.parseProduct({ name: 'P', image: bad }), (e) => e.status === 400, bad);
  }
  assert.equal(darazV.parseProduct({ name: 'P', image: ok }).image, ok);
});

test('dto: Cloudinary public ids are never sent to the browser', () => {
  const { dto } = require('../utils/dto');
  const out = dto({ _id: '507f1f77bcf86cd799439011', name: 'A', logoData: 'https://x', logoPublicId: 'growmore/accounts/x', imagePublicId: 'y' });
  assert.deepEqual(Object.keys(out).sort(), ['id', 'logoData', 'name']);
});
