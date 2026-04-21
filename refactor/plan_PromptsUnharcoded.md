# Plan: Prompts desacoplados del código

## Objetivo

Mover todos los textos de los prompts que hoy están hardcodeados en el código JS a un archivo
`config/prompts.json`. Las claves del JSON describen semánticamente *qué rol cumple cada fragmento*
dentro del sistema de prompts, de modo que editarlos sea autoexplicativo sin necesidad de tocar código.

---

## Prompts hardcodeados actuales

### 1. `llm/classifier.js` — system prompt del clasificador (línea 41-46)

```
Eres un moderador experto de lives musicales. Clasifica mensajes de chat.

Devuelve EXCLUSIVAMENTE JSON válido con este formato:
{ "type": "request|vote|rating|normal|spam", "song": null | "artista - canción" }

Si el mensaje pide una canción, type debe ser "request" y song debe ser "artista - canción". Si no, type es uno de los otros y song es null.
```

### 2. `llm/classifier.js` — user prompt del clasificador (línea 50)

```
Clasifica este mensaje. Devuelve solo el JSON (sin explicaciones).\n\nMensaje: "${text}"
```

### 3. `llm/generator.js` — system prompt del generador (líneas 58-70)

```
Eres el moderador de un live musical: animado, alegre y cercano...
REGLA DE ORO: ...
VARÍA SIEMPRE: ...
Según el mensaje: 1) "Solicitud recibida: ..." ... 4) Mensaje para el live: ...
Formato: responde ÚNICAMENTE un JSON: {"message": "tu frase aquí"}
Máximo 80 caracteres en "message". Usa emojis. Sé animado y variado.
```

### 4. `llm/generator.js` — user prompt del generador (líneas 74-78)

```
Mensaje del usuario: "${userMessage}"
${Canciones más pedidas: ...}
${[REPERTORIO] ...}

Escribe la respuesta (solo el JSON con "message"). Frase natural para el chat, animada y alegre.
```

### 5. `llm/generator.js` — línea de identidad del moderador (línea 44)

```
Tu nombre como moderador es "${moderatorName}". Cuando te etiqueten (@...) o te nombren,
responde SIEMPRE según el contexto del mensaje (saludo, pregunta, petición, etc.).
```

### 6. `rag/songMatcher.js` — contexto RAG para canción encontrada (función `buildRagContext`)

```
[REPERTORIO] La canción "${canonical}" SÍ está en el repertorio del artista.
Confírmalo con entusiasmo y comparte un dato curioso breve sobre ella.
```

### 7. `rag/songMatcher.js` (vía `llm/generator.js`) — contexto RAG para canción NO encontrada

```
[REPERTORIO] La canción pedida NO está en el repertorio conocido del artista.
Discúlpate amablemente, menciona que no la tienes, y anima al usuario a pedir otra canción.
```

---

## Estructura propuesta: `config/prompts.json`

Las claves están pensadas como rutas semánticas `módulo.rol.fragmento`:

```json
{
  "clasificador": {
    "sistema_rol": "Eres un moderador experto de lives musicales. Clasifica mensajes de chat.",
    "usuario": "Clasifica este mensaje. Devuelve solo el JSON (sin explicaciones).\n\nMensaje: \"{texto}\""
  },
  "generador": {
    "sistema_rol_base": "Eres el moderador de un live musical: animado, alegre y cercano. Tu tono es energético y cálido, nunca frío ni cortante. Hablas en tercera persona o \"nosotros\" (somos el equipo del live).",
    "sistema_identidad_moderador": "Tu nombre como moderador es \"{nombre}\". Cuando te etiqueten (@{nombre_sin_espacios}) o te nombren, responde SIEMPRE según el contexto del mensaje (saludo, pregunta, petición, etc.).",
    "sistema_regla_autenticidad": "REGLA DE ORO: Escribe SIEMPRE la frase tal como se diría en el chat. NUNCA repitas instrucciones literales (ej: no digas \"pedir que pidan canciones\"). Inventa la frase natural y con onda.",
    "sistema_regla_variedad": "VARÍA SIEMPRE: cada respuesta debe sonar DISTINTA. No repitas las mismas frases (evita siempre \"mandá tu tema y dale tap tap\", \"seguinos y dale like\", \"¡Hola! ¿Qué te apetece?\"). Usa otras palabras, otros emojis, otro orden, sinónimos. Sé creativo.",
    "sistema_instrucciones_por_tipo": "Según el mensaje:\n1) \"Solicitud recibida: artista - canción\": Un dato curioso breve sobre esa canción. Varía (año, récord, anécdota, país).\n2) Saludo del público o cuando te nombran: Saludo/respuesta alegre y breve, según el contexto.\n3) Pregunta: Respuesta útil y concisa.\n4) Mensaje para el live: La idea te la dan en el mensaje; redacta esa idea de una forma NUEVA, no uses frases hechas.",
    "usuario_plantilla": "Mensaje del usuario: \"{mensaje}\"\n{canciones_pedidas}\n{contexto_repertorio}\n\nEscribe la respuesta (solo el JSON con \"message\"). Frase natural para el chat, animada y alegre.",
    "usuario_canciones_pedidas": "Canciones más pedidas: {lista}"
  },
  "repertorio": {
    "cancion_encontrada": "[REPERTORIO] La canción \"{canonical}\" SÍ está en el repertorio del artista. Confírmalo con entusiasmo y comparte un dato curioso breve sobre ella.",
    "cancion_no_encontrada": "[REPERTORIO] La canción pedida NO está en el repertorio conocido del artista. Discúlpate amablemente, menciona que no la tienes, y anima al usuario a pedir otra canción."
  }
}
```

> `generador.sistema_formato_respuesta` **no existe** en este JSON. La instrucción de formato
> la genera `outputSchemas.generador.instruccionFormato()` directamente desde código.

### Por qué estas claves

`E` = editable en `prompts.json` · `P` = protegida en `outputSchemas.js` (no en JSON)

| Clave | E/P | Qué describe |
|---|:---:|---|
| `clasificador.sistema_rol` | E | Descripción del rol del clasificador ("Eres un moderador experto...") |
| ~~`clasificador.sistema`~~ → `outputSchemas.clasificador` | P | Esquema JSON `{type, song}` que el código parsea; generado desde código |
| `clasificador.usuario` | E | Template del mensaje del usuario; `{texto}` es el placeholder |
| `generador.sistema_rol_base` | E | Quién es el bot (personalidad y tono) |
| `generador.sistema_identidad_moderador` | E | Bloque condicional con nombre del moderador |
| `generador.sistema_regla_autenticidad` | E | Regla que evita que el LLM "rompa la cuarta pared" |
| `generador.sistema_regla_variedad` | E | Regla de variación para no repetir frases |
| `generador.sistema_instrucciones_por_tipo` | E | Comportamiento según tipo de mensaje recibido |
| ~~`generador.sistema_formato_respuesta`~~ → `outputSchemas.generador` | P | Esquema JSON `{message}` que el código parsea; generado desde código |
| `generador.usuario_plantilla` | E | Template del mensaje de usuario con placeholders |
| `generador.usuario_canciones_pedidas` | E | Línea opcional cuando hay canciones en el ranking |
| `repertorio.cancion_encontrada` | E | Contexto RAG: canción en catálogo |
| `repertorio.cancion_no_encontrada` | E | Contexto RAG: canción fuera de catálogo |

---

## Separación: prompts editables vs. estructuras protegidas

Algunos fragmentos de los prompts definen el **esquema JSON** que el código parsea después de
recibir la respuesta del LLM. Si esos fragmentos se modifican en `prompts.json`, el parser se
rompe silenciosamente (no hay excepción, solo datos `undefined`).

### Fragmentos estructurales (NO deben ir en `prompts.json`)

| Fragmento | Dónde lo parsea el código | Riesgo si se edita en el JSON |
|---|---|---|
| `{ "type": "request\|vote\|...", "song": null \| "artista - canción" }` | `classifier.js` → `result.type`, `result.song` | `result.type` sería `undefined`, todos los mensajes caerían a `normal` |
| `{"message": "tu frase aquí"}` | `generator.js` → `parsed.message` | `parsed.message` sería `undefined`, el bot dejaría de responder |

### Solución: `config/outputSchemas.js`

Crear un archivo en código (no en JSON) que sea la única fuente de verdad tanto para la
instrucción de formato que se envía al LLM **como** para el campo que el código extrae:

```javascript
// config/outputSchemas.js
// IMPORTANTE: modificar este archivo requiere actualizar también el código de parseo
// en llm/classifier.js (result.type / result.song) y llm/generator.js (parsed.message).
module.exports = {
  clasificador: {
    // Esquema que se incluye en el prompt del clasificador
    ejemplo: { type: 'request|vote|rating|normal|spam', song: 'null | "artista - canción"' },
    // Campo que classifier.js extrae de la respuesta
    campoTipo: 'type',
    campoCancion: 'song',
    // Instrucción de formato generada automáticamente (no editable por prompts.json)
    instruccionFormato() {
      return `Devuelve EXCLUSIVAMENTE JSON válido con este formato:\n${JSON.stringify(this.ejemplo)}\n\nSi el mensaje pide una canción, type debe ser "request" y song debe ser "artista - canción". Si no, type es uno de los otros y song es null.`;
    },
  },
  generador: {
    // Esquema que se incluye en el prompt del generador
    ejemplo: { message: 'tu frase aquí' },
    // Campo que generator.js extrae de la respuesta
    campoMensaje: 'message',
    // Instrucción de formato generada automáticamente (no editable por prompts.json)
    instruccionFormato() {
      return `Formato: responde ÚNICAMENTE un JSON: ${JSON.stringify(this.ejemplo)}\nMáximo 80 caracteres en "${this.campoMensaje}". Usa emojis. Sé animado y variado.`;
    },
  },
};
```

### Cómo `promptLoader.js` ensambla el system prompt del generador

En lugar de leer `generador.sistema_formato_respuesta` del JSON, llama a `outputSchemas.generador.instruccionFormato()`:

```javascript
// config/promptLoader.js
const schemas = require('./outputSchemas');

function buildGeneratorSystemPrompt(moderatorName) {
  const partes = [
    get('generador.sistema_rol_base'),
    moderatorName
      ? resolve('generador.sistema_identidad_moderador', {
          nombre: moderatorName,
          nombre_sin_espacios: moderatorName.replace(/\s/g, ''),
        })
      : '',
    get('generador.sistema_regla_autenticidad'),
    get('generador.sistema_regla_variedad'),
    get('generador.sistema_instrucciones_por_tipo'),
    schemas.generador.instruccionFormato(),  // ← siempre desde código, nunca desde JSON
  ];
  return partes.filter(Boolean).join('\n\n');
}

function buildClassifierSystemPrompt() {
  return [
    get('clasificador.sistema_rol'),            // ← editable: "Eres un moderador experto..."
    schemas.clasificador.instruccionFormato(),   // ← protegido: el esquema JSON
  ].join('\n\n');
}

module.exports = { get, resolve, buildGeneratorSystemPrompt, buildClassifierSystemPrompt };
```

### Ajuste en `prompts.json`: claves que se eliminan/renombran

| Clave en el plan original | Cambio | Motivo |
|---|---|---|
| `clasificador.sistema` | Se divide en dos | La parte de esquema JSON pasa a `outputSchemas.js` |
| `clasificador.sistema_rol` | Nueva clave (solo el texto de rol) | Editable sin riesgo |
| `generador.sistema_formato_respuesta` | **Eliminada** del JSON | Generada por `outputSchemas.generador.instruccionFormato()` |
| `generador.usuario_instruccion_cierre` | Se puede mantener | Solo es texto de instrucción al usuario, no afecta parseo |

El `prompts.json` final para `clasificador` quedaría:

```json
{
  "clasificador": {
    "sistema_rol": "Eres un moderador experto de lives musicales. Clasifica mensajes de chat.",
    "usuario": "Clasifica este mensaje. Devuelve solo el JSON (sin explicaciones).\n\nMensaje: \"{texto}\""
  }
}
```

### Regla general para el futuro

> Si el fragmento de prompt contiene una **llave JSON, un nombre de campo o un tipo de dato**
> que el código lee con `result.campo` o `parsed.campo`, ese fragmento **no puede estar en
> `prompts.json`**. Debe vivir en `outputSchemas.js` y generarse desde código.

---

## Archivo a crear: `config/promptLoader.js`

Módulo utilitario que carga `prompts.json` y resuelve los placeholders en tiempo de ejecución:

```javascript
// config/promptLoader.js
const prompts = require('./prompts.json');

/**
 * Accede a una clave dot-notation del JSON de prompts.
 * Ejemplo: get('generador.sistema_rol_base')
 */
function get(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], prompts) ?? '';
}

/**
 * Obtiene un prompt y reemplaza los placeholders {clave} con los valores de `vars`.
 * Ejemplo: resolve('clasificador.usuario', { texto: 'hola' })
 */
function resolve(key, vars = {}) {
  let text = get(key);
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, v ?? '');
  }
  return text;
}

module.exports = { get, resolve };
```

---

## Archivos a modificar

### `llm/classifier.js`

Reemplazar los strings hardcodeados con llamadas a `promptLoader`:

```javascript
const { get, resolve } = require('../config/promptLoader');

// system prompt:
content: get('clasificador.sistema')

// user prompt:
content: resolve('clasificador.usuario', { texto: text })
```

### `llm/generator.js`

La función `buildRagContext` pasa de tener strings hardcodeados a:

```javascript
const { resolve } = require('../config/promptLoader');

function buildRagContext(ragResult) {
  if (ragResult.found) {
    return resolve('repertorio.cancion_encontrada', { canonical: ragResult.canonical });
  }
  return get('repertorio.cancion_no_encontrada');
}
```

El system prompt del generador se construye ensamblando las partes configurables:

```javascript
const { get, resolve } = require('../config/promptLoader');

const rolBase        = get('generador.sistema_rol_base');
const identidad      = moderatorName
  ? resolve('generador.sistema_identidad_moderador', {
      nombre: moderatorName,
      nombre_sin_espacios: moderatorName.replace(/\s/g, ''),
    })
  : '';
const reglaAutenticidad = get('generador.sistema_regla_autenticidad');
const reglaVariedad     = get('generador.sistema_regla_variedad');
const instrucciones     = get('generador.sistema_instrucciones_por_tipo');
const formato           = get('generador.sistema_formato_respuesta');

const systemContent = [rolBase, identidad, reglaAutenticidad, reglaVariedad, instrucciones, formato]
  .filter(Boolean)
  .join('\n\n');
```

El user prompt:

```javascript
const canciones = context.topSongs?.length
  ? resolve('generador.usuario_canciones_pedidas', { lista: context.topSongs.join(', ') })
  : '';

const repertorio = context.ragResult ? buildRagContext(context.ragResult) : '';

const userContent = resolve('generador.usuario_plantilla', {
  mensaje: userMessage,
  canciones_pedidas: canciones,
  contexto_repertorio: repertorio,
});
```

---

## Orden de implementación

1. Crear `config/outputSchemas.js` con los esquemas `{type, song}` y `{message}` y sus `instruccionFormato()`
2. Crear `config/prompts.json` **sin** los fragmentos estructurales (ver tabla E/P arriba)
3. Crear `config/promptLoader.js` con `get()`, `resolve()`, `buildClassifierSystemPrompt()` y `buildGeneratorSystemPrompt()`
4. Modificar `llm/classifier.js`: usar `buildClassifierSystemPrompt()` y `resolve('clasificador.usuario', ...)`
5. Modificar `llm/generator.js`: usar `buildGeneratorSystemPrompt()`, user prompt desde plantilla, `buildRagContext()` desde `promptLoader`
6. Verificar con `node -e "require('./llm/generator')"` que no hay errores de carga
7. Smoke test: `node index.js` y enviar un mensaje de prueba al live

---

## Lo que NO cambia

- La lógica de cuándo se llama a cada prompt (eso sigue en `router.js`, `classifier.js`, `generator.js`)
- Los parámetros de Ollama (temperatura, timeout, modelo) siguen en `config/index.js`
- El catálogo de canciones sigue en `rag/songs.json`
- No se introduce ningún sistema de templates externo (Handlebars, etc.); solo `String.replaceAll`
