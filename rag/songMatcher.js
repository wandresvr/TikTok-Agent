// rag/songMatcher.js
// Busca la canción más cercana en el catálogo curado usando alias exactos y similitud fuzzy.
const { distance } = require('fastest-levenshtein');
const config = require('../config');
const songs = require('./songs.json');

/**
 * Normaliza texto para comparación: minúsculas, sin tildes, sin caracteres especiales.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9\s]/g, ' ')   // solo alfanumérico y espacios
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula similitud entre dos strings normalizados (0 a 1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance(a, b) / maxLen;
}

// Índice pre-computado al cargar el módulo (una sola vez)
const index = songs.map(song => ({
  song,
  normCanonical: normalize(song.canonical),
  normTitle: normalize(song.title),
  normArtist: normalize(song.artist),
  normAliases: song.aliases.map(normalize),
}));

/**
 * Busca la canción más parecida en el catálogo.
 * @param {string} rawText - Texto normalizado que viene del normalizador
 * @returns {{ found: boolean, canonical: string, score: number, song: object|null }}
 */
function matchSong(rawText) {
  const threshold = config.rag.threshold;
  const input = normalize(rawText);

  let bestScore = 0;
  let bestEntry = null;

  for (const entry of index) {
    // 1. Alias exacto (match perfecto → score 1.0)
    if (entry.normAliases.includes(input)) {
      return { found: true, canonical: entry.song.canonical, score: 1.0, song: entry.song };
    }

    // 2. Similitud contra canonical, title y title+artist
    const scores = [
      similarity(input, entry.normCanonical),
      similarity(input, entry.normTitle),
      similarity(input, `${entry.normArtist} ${entry.normTitle}`),
      similarity(input, `${entry.normTitle} ${entry.normArtist}`),
    ];

    // 3. Bonus si el input contiene el título como substring
    const substringBonus = entry.normTitle.length >= 4 && input.includes(entry.normTitle) ? 0.15 : 0;

    const score = Math.min(1, Math.max(...scores) + substringBonus);

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestScore >= threshold && bestEntry) {
    return { found: true, canonical: bestEntry.song.canonical, score: bestScore, song: bestEntry.song };
  }

  return { found: false, canonical: rawText, score: bestScore, song: null };
}

module.exports = { matchSong };
