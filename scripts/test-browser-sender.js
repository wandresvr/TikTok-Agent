#!/usr/bin/env node
/**
 * Prueba el screen scraping en Chrome. Abre el live de TikTok y envía un mensaje de prueba.
 *
 * Uso:
 *   node scripts/test-browser-sender.js --launch-chrome   → Abre Chrome, navega a TIKTOK_USERNAME/live y ejecuta la prueba.
 *   node scripts/test-browser-sender.js                  → Conecta a Chrome ya abierto en el puerto 9222 y abre el live.
 *
 * .env: TIKTOK_USERNAME (ej: saximt) para saber qué live abrir. Opcional: CHROME_PATH, BROWSER_DEBUG_PORT.
 */

require('dotenv').config();
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { findChatInput, messageAppearedInChat } = require('../responder/browserSender');

const DEBUG_PORT = process.env.BROWSER_DEBUG_PORT || '9222';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const TEST_MESSAGE = 'Test scraping ' + Date.now();

function waitForPort(port, maxWaitMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      const net = require('net');
      const s = net.createConnection(port, '127.0.0.1', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => {
        if (Date.now() - start >= maxWaitMs) return resolve(false);
        setTimeout(tryConnect, 300);
      });
    };
    tryConnect();
  });
}

async function launchChrome() {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME_PATH, ['--remote-debugging-port=' + DEBUG_PORT], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    child.on('error', reject);
    setTimeout(() => resolve(), 500);
  });
}

async function runTest() {
  const launchChromeFlag = process.argv.includes('--launch-chrome') || process.argv.includes('-l');

  if (launchChromeFlag) {
    console.log('Iniciando Chrome con depuración remota (puerto ' + DEBUG_PORT + ')...');
    console.log('Ruta:', CHROME_PATH);
    try {
      await launchChrome();
    } catch (e) {
      console.error('❌ No se pudo iniciar Chrome. Revisa CHROME_PATH en .env:', e.message);
      process.exit(1);
    }
    console.log('Esperando a que Chrome escuche en el puerto (hasta 25 s)...');
    await new Promise(r => setTimeout(r, 3000));
    const ok = await waitForPort(Number(DEBUG_PORT), 22000);
    if (!ok) {
      console.error('❌ Chrome no respondió en el puerto ' + DEBUG_PORT + '.');
      console.error('   - Cierra TODAS las ventanas de Chrome (y el icono en la bandeja del sistema).');
      console.error('   - Vuelve a ejecutar: node scripts/test-browser-sender.js --launch-chrome');
      console.error('   - O abre Chrome a mano: & "' + CHROME_PATH + '" --remote-debugging-port=' + DEBUG_PORT);
      process.exit(1);
    }
    console.log('Chrome listo. Conectando y abriendo el live...');
    await new Promise(r => setTimeout(r, 2000));
  }

  const cdpUrl = `http://127.0.0.1:${DEBUG_PORT}`;
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
  } catch (err) {
    console.error('❌ No se pudo conectar a Chrome (puerto ' + DEBUG_PORT + ').');
    console.error('   ' + (err.message || err));
    console.error('');
    console.error('Para que funcione:');
    console.error('  1. Cierra TODAS las ventanas de Chrome.');
    console.error('  2. Abre Chrome desde la terminal con depuración remota:');
    console.error('');
    console.error('     Windows (PowerShell):');
    console.error('       & "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=' + DEBUG_PORT);
    console.error('');
    console.error('     O si Chrome está en Program Files (64 bits):');
    console.error('       & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=' + DEBUG_PORT);
    console.error('');
    console.error('     Si usas Edge:');
    console.error('       & "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=' + DEBUG_PORT);
    console.error('');
    console.error('  3. En ese navegador, abre el TikTok Live.');
    console.error('  4. Vuelve a ejecutar: node scripts/test-browser-sender.js');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  if (!context) {
    console.error('❌ No se encontró ningún contexto en el navegador.');
    process.exit(1);
  }

  let page = context.pages().find(p => {
    const u = p.url();
    return u.includes('tiktok.com') && u.includes('/live');
  }) || context.pages()[0];

  if (!page) {
    console.error('❌ No hay pestañas abiertas.');
    process.exit(1);
  }

  const username = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '');
  const liveUrl = username ? `https://www.tiktok.com/@${username}/live` : null;

  if (liveUrl) {
    console.log('Abriendo', liveUrl, '...');
    try {
      await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 4000)); // esperar a que cargue el chat
    } catch (e) {
      console.error('❌ No se pudo cargar el live:', e.message);
      process.exit(1);
    }
  } else {
    const url = page.url();
    if (!url.includes('tiktok.com') || !url.includes('/live')) {
      console.error('❌ Define TIKTOK_USERNAME en .env (ej: saximt) o abre el TikTok Live en Chrome antes de ejecutar la prueba.');
      process.exit(1);
    }
  }

  const url = page.url();
  console.log('--- Prueba de screen scraping en Chrome ---');
  console.log('URL:', url);
  console.log('Mensaje:', TEST_MESSAGE);
  console.log('');

  try {
    const input = await findChatInput(page);
    if (!input) {
      console.error('❌ No se encontró el cuadro de chat. ¿Comentarios activados y live cargado?');
      process.exit(1);
    }

    await input.click({ force: true });
    await input.fill('');
    await new Promise(r => setTimeout(r, 200));
    await input.fill(TEST_MESSAGE);
    await new Promise(r => setTimeout(r, 200));
    await page.keyboard.press('Enter');

    await new Promise(r => setTimeout(r, 3500));

    const found = await messageAppearedInChat(page, TEST_MESSAGE.trim());
    await browser.close(); // solo desconecta, no cierra la ventana de Chrome

    if (found) {
      console.log('✅ Prueba OK: el mensaje se envió y se verificó en el chat.');
      process.exit(0);
    } else {
      console.log('❌ No se pudo verificar el mensaje en el chat (puede que no se haya publicado).');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    process.exit(1);
  }
}

runTest();
