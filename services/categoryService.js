const { Category, Transaction } = require('../models');
const C = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { dto } = require('../utils/dto');

async function ensureDefaults(userId) {
  const docs = [];
  for (const [type, rows] of Object.entries(C.DEFAULT_CATEGORIES)) {
    for (const [name, icon, color] of rows) docs.push({ user: userId, type, name, icon, color, isDefault: true });
  }
  await Category.insertMany(docs, { ordered: false }).catch((e) => { if (e.code !== 11000 && !e.writeErrors) throw e; });
}

const list = async (userId) => (await Category.find({ user: userId, archived: false }).sort({ type: 1, isDefault: -1, name: 1 }).collation({ locale: 'en' }).lean()).map(dto);

async function create(userId, data) {
  try { return dto(await Category.create({ ...data, user: userId })); }
  catch (e) {
    if (e.code === 11000) {
      const existing = await Category.findOne({ user: userId, type: data.type, name: data.name }).collation({ locale: 'en', strength: 2 });
      if (existing && existing.archived) { existing.archived = false; await existing.save(); return dto(existing); }
      throw new ApiError(409, 'That category already exists.', 'DUPLICATE');
    }
    throw e;
  }
}

/** Categories used by transactions are archived (hidden for new entries, history kept); unused ones are deleted. */
async function remove(userId, id) {
  const cat = await Category.findOne({ _id: id, user: userId });
  if (!cat) throw new ApiError(404, 'Category not found.', 'NOT_FOUND');
  const used = await Transaction.exists({ user: userId, category: id });
  if (used) { cat.archived = true; await cat.save(); return { archived: true, deleted: false }; }
  await cat.deleteOne();
  return { archived: false, deleted: true };
}

/** Find-or-create a category by name (case-insensitive); revives it if it was archived. Used by business modules. */
async function ensure(userId, type, name) {
  const def = C.BUSINESS_CATEGORIES[name];
  const col = { locale: 'en', strength: 2 };
  let cat = await Category.findOne({ user: userId, type, name }).collation(col);
  if (!cat) {
    try { cat = await Category.create({ user: userId, type, name, icon: def ? def[1] : 'tag', color: def ? def[2] : '#94A3B8', isDefault: true }); }
    catch (e) { if (e.code !== 11000) throw e; cat = await Category.findOne({ user: userId, type, name }).collation(col); }
  }
  if (cat.archived) { cat.archived = false; await cat.save(); }
  return cat;
}

module.exports = { ensureDefaults, list, create, remove, ensure };
