const v = require('./common');
const images = require('../services/imageService');

const DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_DATA_URI = 450000; // ~330 KB of image: plenty for the resized thumbnail the app sends

/** '' | a PNG/JPEG/WebP data URI (new upload) | one of our own Cloudinary https URLs (picture unchanged). */
exports.imageField = (value, name) => {
  const s = v.str(value, name, { max: MAX_DATA_URI });
  if (!s) return '';
  if (DATA_URI.test(s)) return s;
  if (s.length <= 600 && images.isOurUrl(s)) return s;
  throw v.bad(`${name} must be a PNG, JPEG or WebP image.`);
};
