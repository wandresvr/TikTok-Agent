// config/index.js
// Fuente de verdad de toda la configuración del agente.
// Todos los módulos deben importar desde aquí en lugar de leer process.env directamente.

module.exports = {
  tiktok: {
    username: process.env.TIKTOK_USERNAME || 'saximt',
    sessionId: process.env.TIKTOK_SESSION_ID || null,
    ttTargetIdc: process.env.TIKTOK_TT_TARGET_IDC || null,
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL?.trim() || null,
    timeoutMs: parseInt(process.env.OLLAMA_RESPONSE_TIMEOUT_MS || '120000', 10),
    temperature: parseFloat(process.env.OLLAMA_RESPONSE_TEMPERATURE || '0.85'),
    periodicIntervalMs: parseInt(process.env.OLLAMA_PERIODIC_INTERVAL_MS || '120000', 10) || 0,
  },
  sender: {
    useBrowser: process.env.USE_BROWSER_SENDER === 'true' || process.env.USE_BROWSER_SENDER === '1',
    eulerApiKey: process.env.EULER_API_KEY?.trim() || null,
  },
  bot: {
    moderatorName: process.env.MODERATOR_NAME?.trim() || null,
    enableAutoSend: process.env.ENABLE_AUTO_SEND !== 'false',
    enableSendSongResponses: process.env.ENABLE_SEND_SONG_RESPONSES !== 'false',
    enableMentionResponse: process.env.ENABLE_MENTION_RESPONSE !== 'false',
    showOtherComments: process.env.SHOW_OTHER_COMMENTS === 'true',
    logChatActivity: process.env.LOG_CHAT_ACTIVITY === 'true' || process.env.LOG_CHAT_ACTIVITY === '1',
    saveResponsesCsv: process.env.SAVE_RESPONSES_CSV === 'true',
    responsesCsvPath: process.env.RESPONSES_CSV_PATH?.trim() || './responses.csv',
  },
  rag: {
    enabled: process.env.ENABLE_RAG !== 'false',
    threshold: parseFloat(process.env.RAG_THRESHOLD || '0.75'),
    playlistUrl: process.env.YOUTUBE_PLAYLIST_URL?.trim() || null,
  },
};
