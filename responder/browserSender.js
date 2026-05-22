// responder/browserSender.js
// Envía mensajes al chat de TikTok Live conectándose al Edge ya abierto via CDP.
//
// Requisito: Edge debe estar corriendo con --remote-debugging-port=9222
//   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
//
// Mecanismo de sesión TikTok Live:
//   1. La página del live llama POST /webcast/room/enter/ al cargar.
//      Si retorna 200, TikTok marca este device_id como "inside the room".
//   2. Cada ~5s la página llama GET /webcast/room/check_alive/ para mantener ese estado.
//   3. Un comentario es aceptado SOLO si el device está "inside the room".
//
// Al usar CDP al Edge real: sesión auténtica, sin problemas de fingerprinting.

const CDP_URL = `http://127.0.0.1:${process.env.BROWSER_DEBUG_PORT || 9222}`;

let browser = null;
let livePage = null;

let roomEntered = false;
let lastCheckAlive = 0;
let responseMonitorInstalled = false;
let chatCorsError = false;  // true cuando room/chat falló por CORS/tokens

const NAV_TIMEOUT_MS = 20000;
const ROOM_ENTRY_WAIT_MS = 25000;
const CHECK_ALIVE_STALE_MS = 30000;

async function ensureBrowser() {
  if (browser && browser.isConnected()) return;

  const { chromium } = require('playwright');
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('🔗 [Browser] Conectado al Edge via CDP (' + CDP_URL + ')');
  } catch (err) {
    throw new Error(
      `No se pudo conectar a Edge en ${CDP_URL}.\n` +
      `Abre Edge con: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222\n` +
      `Error: ${err.message}`
    );
  }
}

function _getContext() {
  return browser.contexts()[0];
}

function _installResponseMonitor(p) {
  if (responseMonitorInstalled) return;
  responseMonitorInstalled = true;

  p.on('response', (response) => {
    const url = response.url();
    if (url.includes('webcast/room/enter/')) {
      if (response.status() === 200) {
        if (!roomEntered) console.log('✅ [Browser] room/enter 200 — en la sala, listo para comentar');
        roomEntered = true;
      } else {
        roomEntered = false;
      }
    }
    if (url.includes('webcast/room/check_alive/') && response.status() === 200) {
      lastCheckAlive = Date.now();
    }
    if (url.includes('webcast/room/chat/') && response.status() !== 200) {
      console.warn(`⚠️ [Browser] room/chat devolvió ${response.status()} — tokens expirados, se recargará la página`);
      chatCorsError = true;
    }
  });

  p.on('requestfailed', req => {
    if (req.url().includes('webcast/room/chat/')) {
      console.warn('⚠️ [Browser] room/chat request failed (CORS/red) — se recargará la página');
      chatCorsError = true;
    }
  });
}

async function _waitForRoomEntry(timeoutMs) {
  if (roomEntered) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (roomEntered) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return roomEntered;
}

async function _ensureLivePage(uniqueId) {
  const cleanId = uniqueId.replace('@', '');
  const liveUrl = `https://www.tiktok.com/@${cleanId}/live`;

  await ensureBrowser();
  const ctx = _getContext();

  // Buscar pestaña existente del live en Edge
  const pages = ctx.pages();
  const existing = pages.find(p => !p.isClosed() && p.url().includes(cleanId) && p.url().includes('/live'));

  if (existing) {
    if (livePage !== existing) {
      // Primera vez que encontramos esta pestaña ya cargada en Edge:
      // room/enter ya disparó antes de conectarnos, asumimos que estamos en la sala.
      livePage = existing;
      roomEntered = true;
      lastCheckAlive = Date.now();
      responseMonitorInstalled = false;
      _installResponseMonitor(livePage);
      console.log('🔗 [Browser] Pestaña del live encontrada en Edge — asumiendo room/enter OK');
    } else {
      _installResponseMonitor(livePage);
      // Si check_alive está stale, recargar
      const stale = lastCheckAlive > 0 && (Date.now() - lastCheckAlive) > CHECK_ALIVE_STALE_MS;
      if (stale) {
        console.warn('⚠️ [Browser] check_alive sin respuesta por ' + CHECK_ALIVE_STALE_MS / 1000 + 's — recargando');
        roomEntered = false;
        lastCheckAlive = 0;
        await livePage.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
      }
    }
    return livePage;
  }

  // No hay pestaña del live: abrir una nueva en Edge
  console.log('📂 [Browser] No se encontró pestaña del live — abriendo nueva en Edge');
  livePage = await ctx.newPage();
  roomEntered = false;
  lastCheckAlive = 0;
  responseMonitorInstalled = false;
  _installResponseMonitor(livePage);
  await livePage.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  return livePage;
}

// ─── Selectores del chat ──────────────────────────────────────────────────────

const CHAT_INPUT_SELECTORS = [
  () => p => p.locator('[data-e2e="room-chat-input-field"]'),
  () => p => p.locator('xpath=/html/body/div[1]/main/div[3]/div[2]/div/div[2]/div[2]/div[1]/div/div[1]/div[1]/div'),
  () => p => p.locator('xpath=//*[@id="tiktok-live-main-container-id"]/div[3]/div[2]/div/div[2]/div[2]/div[1]/div/div[1]/div[1]/div'),
  () => p => p.getByRole('textbox'),
  () => p => p.getByPlaceholder(/comment|mensaje|say|add|escribir|chat/i),
  () => p => p.locator('[contenteditable]').first(),
];

async function isSelectorAvailable(el) {
  try {
    await el.waitFor({ state: 'visible', timeout: 2000 });
    if ((await el.count()) === 0) return false;
    const visible = await el.first().isVisible();
    const enabled = await el.first().isEnabled().catch(() => true);
    return visible && enabled;
  } catch {
    return false;
  }
}

async function messageAppearedInChat(p, messageText) {
  if (!messageText) return false;
  const deadline = Date.now() + 5500;
  while (Date.now() < deadline) {
    try {
      const matches = await p.getByText(messageText, { exact: false }).all();
      for (const el of matches) {
        const ce = await el.getAttribute('contenteditable');
        if (ce !== 'true') return true;
      }
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

async function findChatInput(p) {
  for (const getSelector of CHAT_INPUT_SELECTORS) {
    try {
      const locator = getSelector()(p);
      if (await isSelectorAvailable(locator)) return locator;
    } catch { continue; }
  }
  return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

async function sendMessage(uniqueId, message) {
  if (!message || typeof message !== 'string') return false;

  const cleanId = uniqueId.replace('@', '');

  try {
    const p = await _ensureLivePage(cleanId);

    // Si el envío anterior falló por CORS/tokens expirados, recargar para refrescar
    if (chatCorsError) {
      chatCorsError = false;
      console.log('🔄 [Browser] Recargando página para refrescar tokens...');
      roomEntered = false;
      lastCheckAlive = 0;
      await p.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    }

    if (!roomEntered) {
      console.log('⏳ [Browser] Esperando room/enter (máx ' + ROOM_ENTRY_WAIT_MS / 1000 + 's)...');
      const ready = await _waitForRoomEntry(ROOM_ENTRY_WAIT_MS);
      if (!ready) {
        console.warn('⚠️ [Browser] room/enter no retornó 200. Sesión o live inválido.');
        return false;
      }
    }

    const input = await findChatInput(p);
    if (!input) {
      console.warn('⚠️ [Browser] No se encontró input del chat.');
      return false;
    }

    if (!(await isSelectorAvailable(input))) {
      console.warn('⚠️ [Browser] Input del chat no disponible.');
      return false;
    }

    const placeholder = await input.getAttribute('placeholder').catch(() => '');
    if (placeholder && /desactivad|disabled/i.test(placeholder)) {
      console.warn('⚠️ [Browser] Comentarios desactivados en este live.');
      return false;
    }

    await input.click({ force: true });
    await input.fill('');
    await new Promise(r => setTimeout(r, 300));
    await input.fill(message);
    await new Promise(r => setTimeout(r, 200));
    await p.keyboard.press('Enter');

    await new Promise(r => setTimeout(r, 3500));
    const found = await messageAppearedInChat(p, String(message).trim());
    if (found) {
      console.log('✅ [Browser] Mensaje enviado (verificado en chat)');
      return true;
    }
    console.warn('⚠️ [Browser] Mensaje no apareció en el chat.');
    return false;
  } catch (err) {
    // Si la conexión CDP se perdió, resetear para reconectar en el siguiente intento
    if (err.message && (err.message.includes('WebSocket') || err.message.includes('Target closed') || err.message.includes('Connection closed'))) {
      console.warn('⚠️ [Browser] Conexión CDP perdida — se reconectará en el próximo envío');
      browser = null;
      livePage = null;
      roomEntered = false;
      lastCheckAlive = 0;
      responseMonitorInstalled = false;
      chatCorsError = false;
    }
    console.error('❌ [Browser] Error enviando mensaje:', err.message || err);
    return false;
  }
}

async function close() {
  // Solo desconectar Playwright de Edge — no cerrar Edge
  try { if (browser) await browser.close(); } catch { /* ignore */ }
  browser = null;
  livePage = null;
  roomEntered = false;
  lastCheckAlive = 0;
  responseMonitorInstalled = false;
  chatCorsError = false;
}

module.exports = { sendMessage, close, ensureBrowser, messageAppearedInChat, findChatInput };
