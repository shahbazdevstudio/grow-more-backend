/**
 * Tiny whitelist HTML sanitiser for notes (no dependencies).
 * Only these tags survive, with NO attributes: p, br, strong, em, u, ul, ol, li. Everything else is removed
 * (script/style content too). Text is re-escaped. Unclosed tags are closed. Used on the server before saving
 * and again in the browser before display.
 */
const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li']);
const ALIAS = { b: 'strong', i: 'em', div: 'p' };
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);
const VOID = new Set(['br']);

const escText = (t) => t.replace(/&(?!(amp|lt|gt|quot|#39);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sanitizeHtml(input) {
  const src = String(input || '').replace(/\u0000/g, '');
  const tokens = src.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+|</g) || [];
  const out = []; const stack = []; let skipUntil = null;
  for (const tok of tokens) {
    if (tok.startsWith('<!--')) continue;
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)\s*>$/.exec(tok);
    if (!m) { if (!skipUntil) out.push(escText(tok)); continue; } // not a real tag ("a < b", "<<x>") → keep as harmless text
    const closing = m[1] === '/'; const raw = m[2].toLowerCase();
    if (skipUntil) { if (closing && raw === skipUntil) skipUntil = null; continue; }
    if (!closing && DROP_CONTENT.has(raw)) { if (!/\/\s*>$/.test(tok)) skipUntil = raw; continue; }
    const tag = ALIAS[raw] || raw;
    if (!ALLOWED.has(tag)) continue;
    if (VOID.has(tag)) { if (!closing) out.push('<br>'); continue; }
    if (!closing) { stack.push(tag); out.push(`<${tag}>`); }
    else { const i = stack.lastIndexOf(tag); if (i === -1) continue; while (stack.length > i) out.push(`</${stack.pop()}>`); }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

/** Plain text of sanitised HTML (for search and previews). */
function htmlToText(html) {
  return String(html || '').replace(/<\/(p|li)>|<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeHtml, htmlToText };
