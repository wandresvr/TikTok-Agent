// search/songSearch.js
// Busca metadatos de una canción via MusicBrainz (libre, sin API key).
// Retorna un string de contexto para que el LLM genere una curiosidad.
// Independiente de ENABLE_RAG.

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_HEADERS = { 'User-Agent': 'TikTok-MusicBot/1.0 (https://github.com/wandresvr)' };
const TIMEOUT_MS = 8000;

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(id);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(id);
    return null;
  }
}

// Países en español para mostrar en la respuesta
const COUNTRY_NAMES = {
  CO: 'Colombia', MX: 'México', AR: 'Argentina', ES: 'España', US: 'Estados Unidos',
  PR: 'Puerto Rico', VE: 'Venezuela', CL: 'Chile', PE: 'Perú', EC: 'Ecuador',
  CU: 'Cuba', DO: 'República Dominicana', PA: 'Panamá', HN: 'Honduras',
  GT: 'Guatemala', CR: 'Costa Rica', BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay',
  GB: 'Reino Unido', AU: 'Australia', JP: 'Japón', DE: 'Alemania', FR: 'Francia',
  CA: 'Canadá', BR: 'Brasil', IT: 'Italia',
};

/**
 * Extrae el artista del nombre canónico "Canción - Artista" o "Artista - Canción".
 * Devuelve { title, artist } donde artist puede ser ''.
 */
function parseSongInput(songInput) {
  const parts = songInput.split(/\s*[-–]\s*/);
  if (parts.length >= 2) {
    // El canonical del RAG es "Título - Artista"
    return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() };
  }
  return { title: songInput.trim(), artist: '' };
}

/**
 * Busca en MusicBrainz recordings con query field syntax.
 */
async function searchMusicBrainz(title, artist) {
  let query = `recording:"${title}"`;
  if (artist) query += ` AND artist:"${artist}"`;

  const url = `${MB_BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
  const data = await fetchJson(url, MB_HEADERS);
  const rec = data?.recordings?.[0];
  if (!rec) return null;

  const artistName = rec['artist-credit']?.[0]?.artist?.name || artist || '';
  const year = rec['first-release-date']?.substring(0, 4) || '';
  const album = rec.releases?.[0]?.title || '';
  const country = rec.releases?.[0]?.country || '';
  const durationSec = rec.length ? Math.round(rec.length / 1000) : 0;
  const durationMin = durationSec > 0
    ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
    : '';

  const facts = [];
  if (artistName) facts.push(`Artista: ${artistName}`);
  if (year) facts.push(`Año de lanzamiento: ${year}`);
  if (album) facts.push(`Álbum: ${album}`);
  if (country && COUNTRY_NAMES[country]) facts.push(`País: ${COUNTRY_NAMES[country]}`);
  if (durationMin) facts.push(`Duración: ${durationMin}`);

  return facts.length ? facts.join('. ') + '.' : null;
}

/**
 * Busca información sobre una canción para alimentar al LLM.
 * @param {string} songInput - Nombre de la canción (con o sin artista)
 * @returns {Promise<string|null>}
 */
async function searchSongInfo(songInput) {
  const { title, artist } = parseSongInput(songInput);

  // Intento 1: con artista explícito
  if (artist) {
    try {
      const result = await searchMusicBrainz(title, artist);
      if (result) return result;
    } catch { /* continuar */ }
  }

  // Intento 2: solo por título
  try {
    const result = await searchMusicBrainz(title, '');
    if (result) return result;
  } catch { /* continuar */ }

  // Intento 3: input completo como título (para casos sin separador claro)
  if (songInput !== title) {
    try {
      const result = await searchMusicBrainz(songInput, '');
      if (result) return result;
    } catch { /* continuar */ }
  }

  return null;
}

module.exports = { searchSongInfo };
