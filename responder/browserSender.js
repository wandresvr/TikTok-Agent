// responder/browserSender.js
// Envío de mensajes al chat de TikTok Live mediante screen scraping (Playwright).
// No requiere plan premium de Euler Stream. Necesitas iniciar sesión una vez en el perfil del navegador.

const path = require('path');

let context = null;
let page = null;

const NAV_TIMEOUT_MS = 20000;
const INPUT_TIMEOUT_MS = 12000;
const USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR || path.join(process.cwd(), 'browser-profile');

/**
 * Inicia el navegador con perfil persistente (cookies/sesión se guardan).
 * La primera vez, abre el navegador para que inicies sesión en TikTok manualmente.
 */
async function ensureBrowser() {
  if (context) return;

  const { chromium } = require('playwright');
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return context;
}

/**
 * Obtiene o crea una pestaña para el live. Reutiliza la misma página si ya está en ese live.
 */
async function getOrCreatePage(uniqueId) {
  const liveUrl = `https://www.tiktok.com/@${uniqueId.replace('@', '')}/live`;
  if (page && page.url() && page.url().includes(uniqueId.replace('@', ''))) {
    return page;
  }
  if (!context) await ensureBrowser();
  page = context.pages()[0] || await context.newPage();
  return page;
}

/** Selectores del input del chat (TikTok puede cambiar el DOM). */
const CHAT_INPUT_SELECTORS = [
  // XPath absoluto desde html/body (estructura actual de TikTok Live)
  () => page => page.locator('xpath=/html/body/div[1]/main/div[3]/div[2]/div/div[2]/div[2]/div[1]/div/div[1]/div[1]/div'),
  // XPath por id del contenedor del live
  () => page => page.locator('xpath=//*[@id="tiktok-live-main-container-id"]/div[3]/div[2]/div/div[2]/div[2]/div[1]/div/div[1]/div[1]/div'),
  () => page => page.getByRole('textbox'),
  () => page => page.getByPlaceholder(/comment|mensaje|say|add|escribir|chat/i),
  () => page => page.locator('[contenteditable="true"]').first(),
  () => page => page.locator('div[data-e2e="live-chat-input"]'),
  () => page => page.locator('input[type="text"]').first(),
];

/**
 * Comprueba si un elemento del selector está visible y disponible para interacción.
 * @param {import('playwright').Locator} el - Locator del elemento
 * @returns {Promise<boolean>}
 */
async function isSelectorAvailable(el) {
  try {
    await el.waitFor({ state: 'visible', timeout: 2000 });
    const count = await el.count();
    if (count === 0) return false;
    const visible = await el.first().isVisible();
    const enabled = await el.first().isEnabled().catch(() => true); // contenteditable puede no tener isEnabled
    return visible && enabled;
  } catch {
    return false;
  }
}

/**
 * Comprueba si el texto del mensaje aparece en el chat (en un elemento que no sea el input).
 * Así sabemos si TikTok realmente publicó el mensaje.
 * @param {import('playwright').Page} p - Página
 * @param {string} messageText - Texto del mensaje (trimmed)
 * @returns {Promise<boolean>}
 */
async function messageAppearedInChat(p, messageText) {
  if (!messageText) return false;
  const deadline = Date.now() + 5500; // buscar hasta ~5.5 s
  while (Date.now() < deadline) {
    try {
      const matches = await p.getByText(messageText, { exact: false }).all();
      for (const el of matches) {
        const ce = await el.getAttribute('contenteditable');
        if (ce !== 'true') {
          return true; // está en el chat, no en el input
        }
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

/**
 * Busca el input del chat en la página. TikTok puede usar varios patrones.
 * Valida que el selector esté disponible (visible y usable) antes de devolverlo.
 */
async function findChatInput(page) {
  for (const getSelector of CHAT_INPUT_SELECTORS) {
    try {
      const locator = getSelector()(page);
      const available = await isSelectorAvailable(locator);
      if (available) return locator;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Envía un mensaje al chat del live usando el navegador.
 * @param {string} uniqueId - Usuario del live (ej: matsoulpiano o @matsoulpiano)
 * @param {string} message - Texto a enviar
 * @returns {Promise<boolean>} true si se envió, false en caso contrario
 */
async function sendMessage(uniqueId, message) {
  if (!message || typeof message !== 'string') return false;

  const cleanId = uniqueId.replace('@', '');
  const liveUrl = `https://www.tiktok.com/@${cleanId}/live`;

  try {
    await ensureBrowser();
    const p = await getOrCreatePage(cleanId);

    await p.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Esperar a que cargue el contenido del live (chat puede tardar)
    await new Promise(r => setTimeout(r, 3000));

    const input = await findChatInput(p);
    if (!input) {
      console.warn('⚠️ [Browser] No se encontró un cuadro de chat usable. ¿Está el usuario en vivo y con comentarios activados?');
      return false;
    }

    // Revalidar que el selector siga disponible antes de interactuar (DOM puede cambiar)
    const stillAvailable = await isSelectorAvailable(input);
    if (!stillAvailable) {
      console.warn('⚠️ [Browser] Selector del chat dejó de estar disponible antes de enviar.');
      return false;
    }

    // No comprobamos "disabled": el xpath a veces apunta a un contenedor con disabled
    // mientras el campo escribible es otro; si los comentarios están off, el mensaje
    // simplemente no aparecerá en el chat.

    // force: true evita fallar cuando un overlay/otro div intercepta el clic
    await input.click({ force: true });
    await input.fill('');
    await new Promise(r => setTimeout(r, 300));
    await input.fill(message);
    await new Promise(r => setTimeout(r, 200));
    await p.keyboard.press('Enter');

    // Verificar que el mensaje aparezca en el chat (no solo en el input)
    await new Promise(r => setTimeout(r, 3500));
    const trimmed = String(message).trim();
    const foundInChat = await messageAppearedInChat(p, trimmed);
    if (foundInChat) {
      console.log('✅ [Browser] Mensaje enviado por screen scraping (verificado en el chat)');
      return true;
    }
    console.warn('⚠️ [Browser] No se pudo verificar que el mensaje apareciera en el chat. No se dio por enviado.');
    return false;
  } catch (err) {
    console.error('❌ [Browser] Error enviando mensaje:', err.message || err);
    return false;
  }
}

/**
 * Cierra el navegador. Llamar al salir de la aplicación.
 */
async function close() {
  try {
    if (context) await context.close();
  } catch (e) {
    // ignore
  }
  context = null;
  page = null;
}

module.exports = { sendMessage, close, ensureBrowser, messageAppearedInChat, findChatInput };
