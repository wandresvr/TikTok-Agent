const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80
  });

  // 👉 Si ya tienes sesión guardada, descomenta esto
  // const context = await browser.newContext({ storageState: 'session.json' });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔴 CAMBIA POR TU LIVE
  await page.goto('https://www.tiktok.com/el_nelino/live');

  console.log('⏳ Esperando chat...');
  await page.waitForTimeout(8000);

  const processed = new Set();

  async function sendMessage(text) {
    const input = await page.waitForSelector('div[contenteditable="true"]', {
      timeout: 10000
    });

    await input.click();
    await page.keyboard.type(text, { delay: 60 });
    await page.keyboard.press('Enter');
  }

  setInterval(async () => {
    try {
      const messages = await page.$$eval(
        '[data-e2e="chat-message"]',
        nodes => nodes.map(n => n.innerText)
      );

      for (const msg of messages) {
        if (processed.has(msg)) continue;
        processed.add(msg);

        console.log('💬', msg);

        // RESPUESTA DE PRUEBA
        if (msg.toLowerCase().includes('hola')) {
          await sendMessage('idolo');
        }

      }
    } catch (err) {
      console.log('⚠️ Error leyendo chat');
    }
  }, 3000);

})();
