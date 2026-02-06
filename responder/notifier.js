// responder/notifier.js
const { getTop } = require('../state/liveState');

function startNotifier() {
  const intervalId = setInterval(() => {
    const top = getTop(3);
    if (!top.length) return;

    console.clear();
    console.log('🔥 TOP REQUESTS');
    top.forEach(([song, data], i) => {
      console.log(`${i + 1}. ${song} (${data.count})`);
    });
  }, 30000);

  // Retornar función para limpiar el intervalo
  return {
    stop: () => {
      console.log('🛑 Deteniendo notificador...');
      clearInterval(intervalId);
    }
  };
}

module.exports = { startNotifier };
