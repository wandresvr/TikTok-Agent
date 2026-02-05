// state/liveState.js
const requests = new Map();

function addRequest(song, userId) {
  if (!requests.has(song)) {
    requests.set(song, { count: 0, users: new Set() });
  }

  const r = requests.get(song);
  if (!r.users.has(userId)) {
    r.users.add(userId);
    r.count++;
  }
}

function getTop(limit = 5) {
  return [...requests.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);
}

module.exports = { addRequest, getTop };
