// index.js
const { startListener } = require('./listener/tiktokListener');
const { handleMessage } = require('./processor/router');
const { startNotifier } = require('./responder/notifier');

startListener('saximt', async msg => {
  try {
    await handleMessage(msg);
  } catch (e) {
    console.error('Error procesando mensaje', e.message);
  }
});

startNotifier();
