# Plan: RAG de Canciones del Artista

## Objetivo

Integrar un sistema RAG (Retrieval-Augmented Generation) que valide cada solicitud de canción contra un catálogo curado de canciones que el artista realmente conoce. Esto permite:

- Normalizar nombres inconsistentes ("gasolinaaaaa" → "Gasolina - Daddy Yankee")
- Confirmar en el chat si la canción está en el repertorio
- Rechazar educadamente canciones fuera del repertorio
- Usar el nombre canónico para el ranking en `liveState`

---

## Arquitectura Propuesta

```
User: "pon gasolinaaaaa"
  ↓
processor/rules.js         → looksLikeRequest() → true
  ↓
processor/normalizer.js    → "gasolinaaaaa"
  ↓
[NUEVO] rag/songMatcher.js → busca similitud en songs.json
                           → { match: "Gasolina - Daddy Yankee", score: 0.94, found: true }
  ↓
processor/router.js        → usa nombre canónico si found=true
  ↓
state/liveState.js         → addRequest("Gasolina - Daddy Yankee", userId)
  ↓
llm/generator.js           → incluye contexto RAG en el prompt
  ↓
Chat: "¡Gasolina de Daddy Yankee, buena elección! Ya va #2 en los pedidos 🎵"
```

---

## Archivos a Crear

### 1. `rag/songs.json` — Catálogo de canciones

```json
[
  {
    "id": 1,
    "title": "Gasolina",
    "artist": "Daddy Yankee",
    "aliases": ["gasolinaaaaa", "gasolina daddy", "la gasolina"],
    "canonical": "Gasolina - Daddy Yankee"
  },
  {
    "id": 2,
    "title": "Despacito",
    "artist": "Luis Fonsi",
    "aliases": ["despasito", "despacio", "despacito fonsi"],
    "canonical": "Despacito - Luis Fonsi"
  }
  // ... más canciones
]
```

Campos:
- `canonical`: nombre exacto para usar en rankings y respuestas
- `aliases`: variantes comunes con errores ortográficos o apodos

### 2. `rag/songMatcher.js` — Motor de búsqueda

Responsabilidades:
- Cargar `songs.json` al arrancar
- Implementar búsqueda en dos pasos:
  1. **Match exacto/alias**: buscar en `aliases` del catálogo (O(n), rápido)
  2. **Similitud fuzzy**: distancia de Levenshtein normalizada contra `canonical` y `title`
- Exportar `matchSong(rawText)` → `{ found, canonical, score, song }`

```javascript
// Firma de la función principal
function matchSong(rawText) {
  // Returns:
  // { found: true,  canonical: "Gasolina - Daddy Yankee", score: 0.94, song: {...} }
  // { found: false, canonical: rawText, score: 0, song: null }
}
```

Umbral sugerido: `score >= 0.75` para considerar match válido.

Dependencia: `fastest-levenshtein` (npm, zero-deps, muy rápida).

### 3. `rag/index.js` — Punto de entrada del módulo RAG

Re-exporta `matchSong` para que el router lo importe limpiamente:

```javascript
const { matchSong } = require('./songMatcher');
module.exports = { matchSong };
```

---

## Archivos a Modificar

### 4. `processor/router.js` — Integrar RAG en el flujo

En `handleSongRequest(song, msg, tiktokConnection)`, después de recibir el nombre normalizado:

```javascript
const { matchSong } = require('../rag');

async function handleSongRequest(rawSong, msg, tiktokConnection) {
  const ragResult = matchSong(rawSong);
  const canonicalSong = ragResult.found ? ragResult.canonical : rawSong;

  addRequest(canonicalSong, msg.uniqueId);
  const topSongs = getTop(3).map(([s]) => s);

  if (enableSendSongResponses) {
    await queueResponse(msg, topSongs, tiktokConnection, enableAutoSend, {
      ragResult  // contexto RAG para el generador
    });
  }
}
```

### 5. `llm/responseQueue.js` — Pasar contexto RAG al generador

Aceptar `ragContext` opcional en `queueResponse()` y pasarlo a `generateResponse()`.

### 6. `llm/generator.js` — Usar contexto RAG en el prompt

Añadir bloque condicional al mensaje del sistema:

```javascript
// Si la canción fue encontrada en el catálogo:
`La canción pedida "${ragResult.canonical}" SÍ está en el repertorio del artista. Confírmalo con entusiasmo.`

// Si no fue encontrada:
`La canción pedida "${rawSong}" NO está en el repertorio conocido. Discúlpate amablemente y sugiere pedir otra.`
```

### 7. `config/index.js` — Nueva variable de entorno

```javascript
rag: {
  enabled: process.env.ENABLE_RAG !== 'false',         // default true
  threshold: parseFloat(process.env.RAG_THRESHOLD || '0.75'),
}
```

### 8. `.env.example` — Documentar nuevas variables

```ini
ENABLE_RAG=true
RAG_THRESHOLD=0.75
```

---

## Flujo de Decisión Detallado

```
matchSong(rawText)
  ├── score >= RAG_THRESHOLD
  │     └── found: true  → usar canonical, responder con entusiasmo
  └── score < RAG_THRESHOLD
        └── found: false → registrar con nombre raw, responder con disculpa
```

---

## Consideraciones de Implementación

### Fuzzy Matching
- Normalizar ambos lados antes de comparar: lowercase, quitar tildes, colapsar espacios
- Comparar contra `title` solo, contra `artist - title`, y contra cada alias
- Tomar el score máximo de todas las comparaciones

### Rendimiento
- El catálogo se carga una sola vez al arrancar (`require()` cachea el JSON)
- `fastest-levenshtein` procesa ~1M ops/seg, no es cuello de botella
- No hay llamadas a red ni a Ollama en el paso RAG

### Mantenimiento del Catálogo
- `rag/songs.json` es el único archivo a editar para agregar/quitar canciones
- Agregar alias manualmente cuando se detecten variantes frecuentes en `responses.csv`

---

## Orden de Implementación

1. Crear `rag/songs.json` con las canciones reales del artista
2. Instalar dependencia: `npm install fastest-levenshtein`
3. Crear `rag/songMatcher.js` con lógica fuzzy + alias
4. Crear `rag/index.js`
5. Modificar `processor/router.js` para llamar a `matchSong()`
6. Modificar `llm/responseQueue.js` para pasar `ragContext`
7. Modificar `llm/generator.js` para usar `ragContext` en el prompt
8. Actualizar `config/index.js` y `.env.example`
9. Probar con `node index.js` y mensajes de prueba en el live

---

## Prueba Rápida (sin live)

```bash
node -e "
const { matchSong } = require('./rag');
console.log(matchSong('gasolinaaaaa'));
console.log(matchSong('despaciiito'));
console.log(matchSong('una cancion que no existe'));
"
```

Resultado esperado:
```json
{ "found": true,  "canonical": "Gasolina - Daddy Yankee", "score": 0.91 }
{ "found": true,  "canonical": "Despacito - Luis Fonsi",  "score": 0.87 }
{ "found": false, "canonical": "una cancion que no existe", "score": 0.12 }
```
