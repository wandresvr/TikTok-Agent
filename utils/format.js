// utils/format.js
// Helpers de formato de respuestas y persistencia CSV.
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Escapa un valor para CSV (separador ;, comillas y saltos de línea).
 */
function escapeCsvValue(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return /[";\n\r]/.test(s) ? `"${s}"` : s;
}

/**
 * Si ENABLE_MENTION_RESPONSE está habilitado y hay destinatario,
 * devuelve "@destinatario respuesta". Prefiere displayName sobre username.
 */
function formatResponseWithMention(response, username, displayName) {
  if (!response) return response;
  if (!config.bot.enableMentionResponse) return response;
  const mention = (displayName && typeof displayName === 'string' && displayName.trim())
    ? displayName.trim()
    : (username && typeof username === 'string' && username.trim())
      ? username.trim()
      : '';
  if (!mention) return response;
  return `@${mention} ${response}`;
}

/**
 * Si SAVE_RESPONSES_CSV=true, agrega una fila al CSV en RESPONSES_CSV_PATH.
 */
function saveResponseToCsvIfEnabled(user, userMessage, response, sent) {
  if (!config.bot.saveResponsesCsv) return;
  const csvPath = config.bot.responsesCsvPath;
  if (!csvPath) return;
  try {
    const fullPath = path.resolve(csvPath);
    const header = 'fecha;usuario;mensaje_usuario;respuesta_bot;enviado';
    const needsHeader = !fs.existsSync(fullPath);
    const row = [
      new Date().toISOString(),
      escapeCsvValue(user),
      escapeCsvValue(userMessage),
      escapeCsvValue(response),
      '', // enviado: siempre vacío
    ].join(';');
    const line = (needsHeader ? header + '\n' : '') + row + '\n';
    fs.appendFileSync(fullPath, line, 'utf8');
  } catch (e) {
    console.error('❌ Error guardando respuesta en CSV:', e.message);
  }
}

module.exports = { escapeCsvValue, formatResponseWithMention, saveResponseToCsvIfEnabled };
