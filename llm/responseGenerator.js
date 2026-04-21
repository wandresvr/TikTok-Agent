// llm/responseGenerator.js
// Shim de compatibilidad — re-exporta desde los módulos cohesivos.
// Este archivo se mantiene solo para no romper imports externos.
// No agregar lógica aquí: usa los módulos específicos en su lugar.
const { analyze } = require('./classifier');
const { generateResponse } = require('./generator');
const { queueResponse } = require('./responseQueue');
const { shouldRespond, isMessageFromModerator, messageMentionsModerator } = require('../processor/messageFilter');
const { formatResponseWithMention, saveResponseToCsvIfEnabled } = require('../utils/format');

module.exports = {
  analyze,
  generateResponse,
  queueResponse,
  shouldRespond,
  isMessageFromModerator,
  messageMentionsModerator,
  formatResponseWithMention,
  saveResponseToCsvIfEnabled,
};
