// responder/notifier.js
const { getTop } = require('../state/liveState');

function startNotifier() {
  setInterval(() => {
    const top = getTop(3);
    if (!top.length) return;

    console.clear();
    console.log('🔥 TOP REQUESTS');
    top.forEach(([song, data], i) => {
      console.log(`${i + 1}. ${song} (${data.count})`);
    });
  }, 30000);
}

module.exports = { startNotifier };
