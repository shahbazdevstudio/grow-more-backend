/** Plain API shape: `id` instead of `_id`, no internals. Works on lean objects and documents. */
function dto(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const { _id, __v, user, ...rest } = o;
  for (const k of Object.keys(rest)) if (/PublicId$/.test(k)) delete rest[k]; // storage ids stay on the server
  return { id: String(_id), ...rest };
}
module.exports = { dto };
