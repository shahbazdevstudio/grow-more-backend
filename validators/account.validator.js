const C = require('../config/constants');
const v = require('./common');

const { imageField } = require('./image');

exports.parseAccount = (b = {}) => {
  const logoData = imageField(b.logoData, 'Logo'); // '' | new image (data URI) | existing Cloudinary URL
  const logoKey = v.str(b.logoKey, 'Logo key', { max: 40 });
  if (logoKey && !/^[a-z0-9-]+$/.test(logoKey)) throw v.bad('Logo key is invalid.');
  return {
    name: v.str(b.name, 'Account name', { required: true, max: 60 }),
    type: v.oneOf(b.type, C.ACCOUNT_TYPES, 'Account type'),
    description: v.str(b.description, 'Description', { max: 300 }),
    openingBalance: v.money(b.openingBalance, 'Balance', { required: false, allowZero: true, allowNegative: false, def: 0 }),
    logoKey,
    logoData,
    color: v.hexColor(b.color, 'Colour', '#34D399'),
  };
};
