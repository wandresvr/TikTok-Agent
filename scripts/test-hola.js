const { chromium } = require('playwright');

(async () => {
  const browserContext = await chromium.launchPersistentContext(
    './chrome-profile', // carpeta del perfil REAL
    {
      headless: false,
      channel: 'chrome', // 👈 usa Chrome REAL
      slowMo: 80,
      args: [
        '--disable-blink-features=AutomationControlled'
      ]
    }
  );

  const page = await browserContext.newPage();

  // 👉 primera vez: logueate manualmente
  await page.goto('https://www.tiktok.com');

  console.log('🔐 Inicia sesión MANUALMENTE si no estás logueado');
  console.log('▶ Luego entra al LIVE');

  // 🔴 cambia el usuario
  await page.goto('https://www.tiktok.com/@el_nelino/live');

  console.log('⏳ Esperando live...');
  await page.waitForTimeout(10000);

  const input = await page.waitForSelector(
    'div[contenteditable="true"]',
    { timeout: 20000 }
  );

  await input.click();
  await page.keyboard.type('idolo', { delay: 70 });
  await page.keyboard.press('Enter');

  console.log('✅ Mensaje enviado');
})();
