// processor/normalizer.js

function normalizeSong(text) {
    return text
      .toLowerCase()
      // elimina palabras de control
      .replace(/\b(pon|ponme|play|song|canción)\b/gi, '')
      // deja letras Unicode, números, espacios y guión
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      // espacios limpios
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  module.exports = { normalizeSong };
  
  