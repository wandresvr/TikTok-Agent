// responder/notifier.js
const { getTop } = require('../state/liveState');

function startNotifier() {
  const intervalId = setInterval(() => {
    const top = getTop(5);
    if (!top.length) {
      console.log('\n📊 Estadísticas: No hay canciones solicitadas aún');
      return;
    }

    console.log('\n' + '='.repeat(60));
    console.log('🔥 TOP CANCIONES SOLICITADAS');
    console.log('='.repeat(60));
    top.forEach(([song, data], i) => {
      console.log(`${i + 1}. "${song}" - ${data.count} solicitud${data.count > 1 ? 'es' : ''}`);
    });
    console.log('='.repeat(60));
  }, 30000); // Cada 30 segundos

  // Retornar función para limpiar el intervalo
  return {
    stop: () => {
      console.log('🛑 Deteniendo notificador...');
      clearInterval(intervalId);
    }
  };
}

module.exports = { startNotifier };
