// processor/rules.js
const REQUEST_WORDS = ['pon', 'play', 'song', '-'];

function looksLikeRequest(text) {
  const t = text.toLowerCase();
  return REQUEST_WORDS.some(w => t.includes(w));
}

module.exports = { looksLikeRequest };
