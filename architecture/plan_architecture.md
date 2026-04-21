# Plan de Refactorización — TikTok Live Agent

## Diagnóstico de la arquitectura actual

### Problemas identificados

#### 1. God Module: `llm/responseGenerator.js` (645 líneas)
El problema más grave del proyecto. Un solo archivo mezcla **cinco responsabilidades distintas**:

| Responsabilidad | Funciones |
|---|---|
| Cliente HTTP de Ollama | `getAvailableModels`, `checkOllamaAvailable`, `findAvailableModel`, `makeRequestWithRetry`, `waitForRateLimit` |
| Clasificación LLM | `analyze` |
| Generación de respuestas | `generateResponse` |
| Cola de respuestas | `queueResponse`, `processResponseQueue` |
| Filtro de mensajes | `shouldRespond`, `isMessageFromModerator`, `messageMentionsModerator` |
| Utilidades de formato/CSV | `formatResponseWithMention`, `saveResponseToCsvIfEnabled`, `escapeCsvValue` |

Consecuencia: cualquier cambio en la capa HTTP obliga a abrir el mismo archivo que contiene la lógica de negocio del chat.

#### 2. `index.js` como orchestrator + módulo de negocio (230 líneas)
`index.js` debería ser solo el punto de arranque (wire-up de dependencias). En cambio también contiene:
- Lógica de validación de Ollama (`checkOllamaOnStart`)
- Los arrays `PERIODIC_PROMPT_HINTS` / `PERIODIC_TWISTS` y el `setInterval` del bot periódico
- La configuración de `SignConfig` de Euler
- Lógica de reconexión implícita

#### 3. Código duplicado en `processor/router.js`
El bloque completo de "detectar canción → actualizar estado → generar respuesta → enviar → loggear CSV" aparece **dos veces** (~40 líneas cada vez): una para la rama de reglas rápidas y otra para la rama LLM. Son idénticos salvo por la variable de la canción.

#### 4. Config dispersa
Las variables de entorno se leen con `process.env.*` en **cinco archivos distintos** (`index.js`, `router.js`, `responseGenerator.js`, `tiktokListener.js`, `browserSender.js`). No existe una fuente de verdad central; cambiar el nombre de una variable requiere buscar en todo el proyecto.

#### 5. Estado mutable global sin encapsulación
`responseGenerator.js` acumula **11 variables globales mutables** (`responseErrorShown`, `availableModel`, `lastRequestTime`, `consecutive500Errors`, `responseQueue`, `isProcessingQueue`, `lastResponseTime`, etc.) en el scope del módulo. Esto es un antipatrón en Node.js: dificulta el testing, los reinicios parciales y el razonamiento sobre efectos secundarios.

#### 6. URL de Ollama hard-codeada repetida
`http://localhost:11434` aparece literalmente en 4 lugares distintos del código.

---

## Plan de refactorización

> **Criterio de prioridad:** impacto en legibilidad vs. riesgo de romper funcionalidad existente.  
> Cada fase es independiente y puede hacerse en un PR separado.

---

### Fase 1 — Módulo de configuración central
**Archivos afectados:** nuevo `config/index.js`, todos los archivos que leen `process.env`

Crear un único módulo que lea todas las variables de entorno **una sola vez** y exporte un objeto tipado:

```
config/
  index.js   ← fuente de verdad de toda la config
```

```js
// config/index.js
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
    periodicIntervalMs: parseInt(process.env.OLLAMA_PERIODIC_INTERVAL_MS || '120000', 10),
  },
  sender: {
    useBrowser: process.env.USE_BROWSER_SENDER === 'true',
    browserDataDir: process.env.BROWSER_USER_DATA_DIR || './browser-profile',
    browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
    eulerApiKey: process.env.EULER_API_KEY?.trim() || null,
  },
  bot: {
    moderatorName: process.env.MODERATOR_NAME?.trim() || null,
    enableAutoSend: process.env.ENABLE_AUTO_SEND !== 'false',
    enableSendSongResponses: process.env.ENABLE_SEND_SONG_RESPONSES !== 'false',
    enableMentionResponse: process.env.ENABLE_MENTION_RESPONSE !== 'false',
    showOtherComments: process.env.SHOW_OTHER_COMMENTS === 'true',
    logChatActivity: process.env.LOG_CHAT_ACTIVITY === 'true',
    saveResponsesCsv: process.env.SAVE_RESPONSES_CSV === 'true',
    responsesCsvPath: process.env.RESPONSES_CSV_PATH?.trim() || './responses.csv',
  },
};
```

**Beneficio:** un solo `require('./config')` en cada módulo. Cambiar el nombre de una variable de entorno es un cambio de una sola línea.

---

### Fase 2 — Romper el God Module en 4 módulos cohesivos

Estructura objetivo:

```
llm/
  ollamaClient.js   ← HTTP layer (fetch, rate limit, retry, model discovery)
  classifier.js     ← analyze() — clasifica mensajes
  generator.js      ← generateResponse() — genera respuestas de chat
  responseQueue.js  ← queueResponse(), processResponseQueue()
```

Los helpers de mensaje (`shouldRespond`, `isMessageFromModerator`, `messageMentionsModerator`) y de formato (`formatResponseWithMention`, `saveResponseToCsvIfEnabled`) se mueven a:

```
processor/
  messageFilter.js  ← shouldRespond, isMessageFromModerator, messageMentionsModerator
utils/
  format.js         ← formatResponseWithMention, escapeCsvValue, saveResponseToCsvIfEnabled
```

#### `llm/ollamaClient.js` — detalle
Encapsula el estado mutable como variables de módulo privadas (ya que Node cachea los módulos, el singleton es correcto aquí, pero queda aislado):

```js
// Variables privadas del módulo — no se exportan
let _availableModel = null;
let _lastRequestTime = 0;
let _consecutive500Errors = 0;

// Exporta solo las funciones de alto nivel
module.exports = { findAvailableModel, makeRequest, checkAvailable };
```

#### `llm/responseQueue.js` — detalle
Encapsula el estado de la cola de la misma forma:

```js
let _queue = [];
let _processing = false;
let _lastResponseTime = 0;

module.exports = { enqueue, processQueue };
```

**Beneficio:** `responseGenerator.js` pasa de 645 líneas a ~100 por módulo. Cada archivo hace una sola cosa.

---

### Fase 3 — Eliminar la duplicación en `router.js`

Extraer una función privada `handleSongRequest`:

```js
// Antes: dos bloques de ~40 líneas casi idénticos
// Después: una función reutilizada

async function handleSongRequest(song, userId, msg) {
  addRequest(song, userId);
  const topSongs = getTop(3).map(([s]) => s);
  console.log(`🎵 Canción detectada: "${song}"`);
  console.log(`📊 Top: ${topSongs.join(', ') || 'Ninguna'}`);

  if (!config.bot.enableSendSongResponses) return;

  const response = await generateResponse(`Solicitud recibida: ${song}`, { topSongs });
  if (!response) return;

  const textToSend = formatResponseWithMention(response, msg.user, msg.displayName);
  const sent = config.bot.enableAutoSend && tiktokConnection
    ? await tiktokConnection.sendMessage(textToSend)
    : false;

  if (!sent) console.log(`💬 Respuesta (no enviada): "${response}"`);
  saveResponseToCsvIfEnabled(msg.user, `Solicitud recibida: ${song}`, textToSend, sent);
}
```

**Beneficio:** `router.js` pasa de 143 líneas a ~80. Un solo lugar donde cambiar la lógica de respuesta a canciones.

---

### Fase 4 — Extraer la lógica periódica de `index.js`

Mover el bot periódico a su propio módulo:

```
responder/
  periodicSender.js   ← PERIODIC_PROMPT_HINTS, PERIODIC_TWISTS, setInterval
```

```js
// responder/periodicSender.js
function startPeriodicSender(sendMessage) {
  const { periodicIntervalMs } = config.ollama;
  if (periodicIntervalMs <= 0) return { stop: () => {} };

  let count = 0;
  const id = setInterval(async () => {
    const hint = HINTS[count % HINTS.length];
    const twist = TWISTS[Math.floor(Math.random() * TWISTS.length)];
    count++;
    const response = await generateResponse(`Genera una frase corta y alegre para el live. ${hint} ${twist}`, {});
    if (response) await sendMessage(response);
  }, periodicIntervalMs);

  return { stop: () => clearInterval(id) };
}

module.exports = { startPeriodicSender };
```

**Beneficio:** `index.js` queda como un orquestador puro de ~60 líneas.

---

### Fase 5 — Limpiar `index.js` (consecuencia de fases 1–4)

Después de las fases anteriores, `index.js` queda así:

```js
require('dotenv').config();
const config = require('./config');
const { startListener } = require('./listener/tiktokListener');
const { handleMessage, setTikTokConnection } = require('./processor/router');
const { startNotifier } = require('./responder/notifier');
const { startPeriodicSender } = require('./responder/periodicSender');
const { checkOllamaOnStart } = require('./llm/ollamaClient');

async function main() {
  await checkOllamaOnStart();
  const connection = startListener(config.tiktok.username, handleMessage);
  setTikTokConnection(connection);
  const notifier = startNotifier();
  const periodic = startPeriodicSender(msg => connection.sendMessage(msg));

  const cleanup = async () => {
    periodic.stop();
    notifier.stop();
    await connection.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main();
```

---

## Resumen del plan

| Fase | Qué hace | Impacto | Riesgo | Estado |
|---|---|---|---|---|
| 1 | Config central (`config/index.js`) | Elimina `process.env` disperso | Bajo | ✅ Completada |
| 2 | Rompe `responseGenerator.js` en 4 módulos | Mayor legibilidad y cohesión | Medio (muchos imports cambian) | ✅ Completada |
| 3 | Deduplica handler de canciones en `router.js` | Elimina ~40 líneas repetidas | Bajo | ✅ Completada |
| 4 | Extrae `periodicSender.js` | `index.js` queda limpio | Bajo | ✅ Completada |
| 5 | Simplifica `index.js` | Orquestador puro ~50 líneas | Bajo (consecuencia de 1–4) | ✅ Completada |

**Orden ejecutado:** 1 → 2 → 3 → 4 → 5.  
Todas las fases completadas al 2026-04-19.

**Cambios reales de Fase 5:**
- `checkOllamaOnStart` movida a `llm/ollamaClient.js` (exportada)
- Banner de inicio + SignConfig + `connectionOptions` extraídos a `config/bootstrap.js`
- `index.js` pasó de 155 → ~50 líneas como orquestador puro

---

## Estructura de carpetas objetivo

```
TikTok-Agent/
├── config/
│   └── index.js                 ← NEW: fuente de verdad de config
├── listener/
│   └── tiktokListener.js        (sin cambios de API pública)
├── processor/
│   ├── router.js                (simplificado, sin duplicación)
│   ├── messageFilter.js         ← MOVED desde responseGenerator.js
│   ├── rules.js
│   └── normalizer.js
├── llm/
│   ├── ollamaClient.js          ← NEW: HTTP layer de Ollama
│   ├── classifier.js            ← NEW: analyze()
│   ├── generator.js             ← NEW: generateResponse()
│   └── responseQueue.js         ← NEW: cola de respuestas
├── responder/
│   ├── browserSender.js
│   ├── notifier.js
│   └── periodicSender.js        ← MOVED desde index.js
├── state/
│   └── liveState.js             (sin cambios)
├── utils/
│   └── format.js                ← NEW: formatResponseWithMention, CSV helpers
└── index.js                     (orquestador puro ~60 líneas)
```
