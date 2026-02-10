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
  if (browser) return;

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

/**
 * Busca el input del chat en la página. TikTok puede usar varios patrones.
 */
async function findChatInput(page) {
  const selectors = [
    () => page.locator('xpath=//*[@id="tiktok-live-main-container-id"]/div[3]/div[2]/div/div[2]/div[2]/div[1]/div/div[1]/div[1]/div'),
    () => page.getByRole('textbox'),
    () => page.getByPlaceholder(/comment|mensaje|say|add|escribir|chat/i),
    () => page.locator('[contenteditable="true"]').first(),
    () => page.locator('div[data-e2e="live-chat-input"]'),
    () => page.locator('input[type="text"]').first(),
  ];

  for (const getSelector of selectors) {
    try {
      const el = getSelector();
      await el.waitFor({ state: 'visible', timeout: 3000 });
      return el;
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
      console.warn('⚠️ [Browser] No se encontró el cuadro de chat. ¿Está el usuario en vivo?');
      return false;
    }

    await input.click();
    await input.fill('');
    await new Promise(r => setTimeout(r, 300));
    await input.fill(message);
    await new Promise(r => setTimeout(r, 200));
    await p.keyboard.press('Enter');

    console.log('✅ [Browser] Mensaje enviado por screen scraping');
    return true;
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

module.exports = { sendMessage, close, ensureBrowser };
