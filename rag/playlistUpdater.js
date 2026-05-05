// rag/playlistUpdater.js
// Fetches a YouTube playlist via yt-dlp and rewrites songs.json.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SONGS_PATH = path.join(__dirname, 'songs.json');

// ── Text helpers ────────────────────────────────────────────────────────────

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Order matters: emojis first, then text patterns
const NOISE_RE = [
  /[☀-➿🀀-🏿🐀-🟿 -⁯─-⯯©®™⌚-⌛⏩-⏳⏸-⏺▪-▫▶◀◻-◾☔-☕♈-♓♿⚓⚡⚪-⚫⚽-⚾⛄-⛅⛎⛔⛪⛲-⛳⛵⛺⛽✂✅✈-✍✏✒✔✖✝✡✨✳-✴❄❇❌❎❓-❕❗❣-❤➕-➗➡➰➿⤴-⤵⬅-⬇⬛-⬜⭐⭕〰〽㊗㊙]/gu,
  /[♠♣♥♦♪♫♬🎤🎵🎶]/gu,
  /\(?versi[oó]n karaoke\)?/gi,
  /\(?versi[oó]n piano\)?/gi,
  /\[?karaoke version\]?/gi,
  /\(en vivo\)/gi,
  /\(mtv unplugged\)/gi,
  /karaoke 4k/gi,
  /\(tono original\)/gi,
  /\(?ft\. [^)]+\)?/gi,
  /made popular by [^)[\]]+/gi,
  /\[letra\]/gi,
  /\/\/ ?letra/gi,
  /\s*[|\s]canta como puedas/gi,
  /\be instrumental\b/gi,
  /\b(karaoke|letra|instrumental|4k)\b/gi,
];

// Clean noise without collapsing spaces (double-space = separator, must survive)
function cleanTitle(t) {
  for (const re of NOISE_RE) t = t.replace(re, '');
  return t.replace(/^[-|/() ]+|[-|/() ]+$/g, '').trim();
}

function collapseSpaces(t) {
  return t.replace(/\s+/g, ' ').trim().replace(/^[-|/() ]+|[-|/() ]+$/g, '').trim();
}

// ── Artist / song parser ────────────────────────────────────────────────────

function parseArtistSong(rawTitle, uploader) {
  let clean = cleanTitle(rawTitle);

  // Remove leading "Karaoke" prefix (e.g. "Karaoke VOY A VOS - Artist")
  clean = clean.replace(/^karaoke\s+/i, '').trim();

  // "Song by Artist"
  const byMatch = collapseSpaces(clean).match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };

  // Pipe format: "Song | Artist" or "Title | noise | Artist"
  if (clean.includes('|')) {
    const parts = clean.split('|').map(p => collapseSpaces(p)).filter(Boolean);
    if (parts.length === 2) return { title: parts[0], artist: parts[1] };
    if (parts.length >= 3) return { title: parts[0], artist: parts[parts.length - 1] };
  }

  // Double-space check BEFORE collapsing: "Artist  Song"
  // Require both sides to have no dashes (avoids firing on "Song -  - Artist" after noise removal)
  const dblSpace = clean.match(/^([^-–]+?)\s{2,}([^-–]+)$/);
  if (dblSpace) {
    return {
      title: collapseSpaces(dblSpace[2]),
      artist: collapseSpaces(dblSpace[1]),
    };
  }

  // Collapse spaces now for dash-based parsing
  const collapsed = collapseSpaces(clean);

  // Dash(es): split and pick best parts
  const dashParts = collapsed.split(/\s*[-–]\s*/);
  if (dashParts.length === 2) {
    // Typical karaoke format: "Artist - Song"
    return { title: dashParts[1].trim(), artist: dashParts[0].trim() };
  }
  if (dashParts.length >= 3) {
    // "Song - noise - Artist" or "Artist - Song - noise" — use first and last
    return { title: dashParts[0].trim(), artist: dashParts[dashParts.length - 1].trim() };
  }

  // Fallback: use YouTube "Artist - Topic" uploader channel as artist hint
  if (uploader) {
    const topicMatch = uploader.match(/^(.+?)\s*-\s*Topic$/i);
    if (topicMatch) return { title: collapsed, artist: topicMatch[1].trim() };
  }

  return { title: collapsed, artist: '' };
}

// ── Alias generator ─────────────────────────────────────────────────────────

function generateAliases(title, artist) {
  const aliases = new Set();
  const nt = normalize(title);
  const na = normalize(artist);

  if (nt) aliases.add(nt);
  if (na) {
    aliases.add(na);
    aliases.add(`${nt} ${na}`);
    aliases.add(`${na} ${nt}`);
  }
  // Short prefix (first 3 words) for long titles
  const words = nt.split(' ');
  if (words.length > 3) aliases.add(words.slice(0, 3).join(' '));

  return [...aliases].filter(Boolean);
}

// ── yt-dlp runner ───────────────────────────────────────────────────────────

function runYtDlp(playlistUrl) {
  return new Promise((resolve, reject) => {
    const candidates = [
      { cmd: 'python', args: ['-m', 'yt_dlp', '--flat-playlist', '--dump-json', playlistUrl] },
      { cmd: 'python3', args: ['-m', 'yt_dlp', '--flat-playlist', '--dump-json', playlistUrl] },
      { cmd: 'yt-dlp', args: ['--flat-playlist', '--dump-json', playlistUrl] },
    ];

    function tryNext(i) {
      if (i >= candidates.length) {
        reject(new Error('yt-dlp no encontrado. Instálalo con: pip install yt-dlp'));
        return;
      }
      const { cmd, args } = candidates[i];
      const chunks = [];
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });

      proc.stdout.on('data', d => chunks.push(d));
      proc.on('error', () => tryNext(i + 1));
      proc.on('close', code => {
        const out = Buffer.concat(chunks).toString('utf8');
        if (code !== 0 && !out.trim()) { tryNext(i + 1); return; }
        resolve(out);
      });
    }

    tryNext(0);
  });
}

// ── Main export ─────────────────────────────────────────────────────────────

async function updateSongsFromPlaylist(playlistUrl) {
  console.log(`🎵 Actualizando catálogo de canciones desde playlist de YouTube...`);

  let raw;
  try {
    raw = await runYtDlp(playlistUrl);
  } catch (e) {
    console.warn(`⚠️  Playlist update omitida: ${e.message}`);
    return false;
  }

  const entries = raw
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  if (!entries.length) {
    console.warn('⚠️  No se encontraron videos en la playlist. Se mantiene songs.json existente.');
    return false;
  }

  const songs = entries
    .map(e => {
      const { title, artist } = parseArtistSong(e.title || '', e.uploader || '');
      if (!title) return null;
      const canonical = artist ? `${title} - ${artist}` : title;
      return { title, artist, aliases: generateAliases(title, artist), canonical };
    })
    .filter(Boolean);

  fs.writeFileSync(SONGS_PATH, JSON.stringify(songs, null, 2), 'utf8');
  console.log(`✅ songs.json actualizado: ${songs.length} canciones desde la playlist.`);
  return true;
}

module.exports = { updateSongsFromPlaylist };
