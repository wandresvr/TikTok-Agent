const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.tiktok.com/login');

  console.log('🔐 Inicia sesión MANUALMENTE...');
  console.log('⏳ Tienes tiempo, cuando termines vuelve aquí');

  // espera a que confirmes login viendo el feed
  await page.waitForURL('https://www.tiktok.com/*', {
    timeout: 0
  });

  // guarda sesión
  await context.storageState({ path: 'session.json' });
  console.log('✅ Sesión guardada como session.json');

})();
