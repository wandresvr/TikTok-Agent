# TikTok Live Agent

### Wilson Andrés Vargas Rojas

# Contexto

Un streamer de TikTok que hace lives musicales necesita un agente que escuche el chat en tiempo real, detecte solicitudes de canciones, mantenga un ranking de las más pedidas y pueda responder a los espectadores de forma automática. El sistema debe conectarse al live, procesar los mensajes (ya sea por reglas rápidas o con un modelo de lenguaje), gestionar el estado de las canciones solicitadas y, opcionalmente, enviar mensajes al chat ya sea mediante API (Euler Stream) o mediante automatización del navegador.

# Descripción

Este proyecto es un agente para TikTok Live desarrollado en Node.js. Se compone de un listener que se conecta al live, un procesador que clasifica mensajes (solicitudes de canción, saludos, preguntas) y un módulo de respuesta que usa Ollama como LLM local para generar y enviar mensajes al chat. La arquitectura separa claramente la escucha, las reglas de negocio, el estado en memoria y la generación de respuestas.

### Listener

Es el módulo encargado de conectarse al live de TikTok mediante `tiktok-live-connector`, escuchar eventos de chat y exponer una función para enviar mensajes (por API Euler o por screen scraping con Playwright).

### Processor

Gestiona cada mensaje entrante: aplica reglas rápidas para detectar pedidos de canción (por palabras clave), normaliza el nombre de la canción y, si el mensaje es más largo, usa el LLM (Ollama) para clasificarlo en tipos como `request`, `normal`, etc. Las canciones detectadas se agregan al estado y, si está habilitado, se genera y envía una respuesta al chat.

### Responder

Incluye el notificador que imprime periódicamente el top de canciones solicitadas y el envío de mensajes al chat (por Euler Stream o por navegador con Playwright).

### LLM (Ollama)

Se utiliza Ollama como modelo de lenguaje local para dos fines: clasificar mensajes (con salida JSON) y generar respuestas breves y naturales para el chat. Soporta rate limiting, reintentos ante errores 500 y cola de respuestas con cooldown.

### State

Mantiene en memoria un ranking de canciones solicitadas (por canción y por usuario) y expone funciones para agregar pedidos y obtener el top N.

## Flujo de trabajo

- Un espectador escribe en el chat del live; el listener recibe el mensaje y lo pasa al procesador.
- El procesador aplica primero reglas rápidas (palabras como "pon", "play", "song"); si coincide y el texto normalizado es una canción válida, se registra en el estado y, si está habilitado, se genera una respuesta con Ollama y se envía al chat.
- Si el mensaje no se clasifica por reglas, se envía a Ollama para clasificación (JSON: tipo y posible canción). Si el tipo es solicitud de canción, se registra y se responde igual que antes.
- Si el mensaje es una pregunta, saludo o mención que merece respuesta, se encola; la cola se procesa con cooldown y rate limiting, y la respuesta se envía por la conexión configurada (Euler o navegador).
- El notificador imprime cada cierto tiempo el top de canciones. Opcionalmente se puede configurar un mensaje periódico generado por Ollama (por ejemplo, pedir canciones o animar con tap tap).

``` mermaid
sequenceDiagram
 participant Espectador
 participant Listener
 participant Processor
 participant State
 participant Ollama
 participant Chat

 Espectador->>Listener: Mensaje en el chat
 Listener->>Processor: handleMessage(msg)

 alt Reglas rápidas: pedido de canción
 Processor->>Processor: normalizeSong(text)
 Processor->>State: addRequest(song, userId)
 Processor->>Ollama: generateResponse(...)
 Ollama-->>Processor: respuesta
 Processor->>Chat: sendMessage(respuesta)
 else Mensaje largo: clasificación LLM
 Processor->>Ollama: analyze(text) → JSON
 Ollama-->>Processor: type, song
 alt type === 'request'
 Processor->>State: addRequest(song, userId)
 Processor->>Ollama: generateResponse(...)
 Processor->>Chat: sendMessage(respuesta)
 else Debe responder (saludo, pregunta)
 Processor->>Processor: queueResponse(msg, ...)
 Processor->>Ollama: generateResponse(msg.text)
 Processor->>Chat: sendMessage(respuesta)
 end
 end

 Note over State: getTop(N) → notificador y contexto para respuestas
```

## Implementaciones y dependencias

### Node.js

El proyecto está desarrollado en Node.js. En el `package.json` se definen las dependencias y scripts. Para ejecutar el agente se usa `node index.js` desde la raíz del proyecto.

### dotenv

Se utiliza `dotenv` para cargar variables de entorno desde un archivo `.env` en la raíz. Ahí se configuran el usuario de TikTok, las credenciales para enviar mensajes, el modelo de Ollama, los timeouts y las opciones de envío (automático, browser, CSV, etc.).

### tiktok-live-connector

Librería que permite conectarse al live de TikTok sin API oficial: recibe eventos de chat en tiempo real y, con credenciales y API key de Euler Stream (plan premium), puede enviar mensajes. El proyecto configura `SignConfig.apiKey` con `EULER_API_KEY` para firmar las peticiones cuando se usa envío por API.

### Ollama

Se usa Ollama como LLM local en `http://localhost:11434`. Sirve para clasificar mensajes (endpoint de chat con `format: 'json'`) y para generar respuestas breves en español. El modelo puede fijarse con `OLLAMA_MODEL` en `.env` o dejarse en detección automática. Se recomienda tener Ollama en ejecución (`ollama serve`) y al menos un modelo instalado (por ejemplo `llama3.2:1b` o `qwen2.5:1.5b`).

### Playwright (browser sender)

Cuando `USE_BROWSER_SENDER=true`, el envío de mensajes se hace por automatización del navegador (screen scraping) en lugar de la API de Euler. No requiere plan premium: se usa un perfil persistente para mantener la sesión de TikTok; la primera vez el usuario debe iniciar sesión manualmente. La ruta del perfil se configura con `BROWSER_USER_DATA_DIR`.

### Euler Stream

Opcional. Si no se usa browser sender, se puede configurar `EULER_API_KEY` para enviar mensajes al chat mediante la API de Euler Stream (suele requerir plan de pago). La API key se asigna globalmente con `SignConfig.apiKey` antes de crear la conexión.

## Configuración y despliegue

### Variables de entorno (.env)

En la raíz del proyecto debe existir un archivo `.env`. Algunas variables relevantes:

- **TIKTOK_USERNAME**: usuario del live a escuchar (sin @).
- **TIKTOK_SESSION_ID**, **TIKTOK_TT_TARGET_IDC**: credenciales para envío por API (cookies de sesión).
- **USE_BROWSER_SENDER**: `true` para envío por navegador, `false` para Euler (con API key).
- **EULER_API_KEY**: API key de Euler Stream cuando no se usa browser sender.
- **OLLAMA_MODEL**: modelo de Ollama (opcional; si no se define, se elige uno disponible).
- **ENABLE_AUTO_SEND**: `true` para que el bot envíe mensajes al chat, `false` para solo escuchar y registrar.
- **ENABLE_SEND_SONG_RESPONSES**: enviar o no respuestas cuando se detecta una solicitud de canción.
- **OLLAMA_PERIODIC_INTERVAL_MS**: intervalo en ms para mensajes periódicos generados por Ollama (0 = desactivado).
- **SAVE_RESPONSES_CSV**, **RESPONSES_CSV_PATH**: guardar respuestas en un archivo CSV.

### Ejecución

1. Instalar dependencias: `npm install`
2. Copiar o crear `.env` con las variables necesarias.
3. (Opcional) Tener Ollama en marcha y un modelo instalado: `ollama serve` y `ollama pull <modelo>`.
4. Iniciar el agente: `node index.js`

El agente se conecta al live de `TIKTOK_USERNAME`, procesa mensajes y, según la configuración, envía respuestas y muestra en consola el top de canciones y los logs de envío.

### Scripts

- **npm run test**: script por defecto (sin pruebas implementadas).
- **npm run test:browser-sender**: ejecuta `scripts/test-browser-sender.js` para probar el envío por navegador.

# Tabla de contenido

1. [Contexto](#contexto)
2. [Descripción](#descripción)
   - Listener
   - Processor
   - Responder
   - LLM (Ollama)
   - State
3. [Flujo de trabajo](#flujo-de-trabajo)
4. [Implementaciones y dependencias](#implementaciones-y-dependencias)
5. [Configuración y despliegue](#configuración-y-despliegue)
   - Variables de entorno (.env)
   - Ejecución
   - Scripts
