/** Répond dès que les premiers catalogues utiles sont disponibles. */
function collectCatalogResults(tasks, { timeoutMs = 1500, settleMs = 180, onComplete = () => {} } = {}) {
  return new Promise(resolve => {
    const groups = new Array(tasks.length).fill(null);
    let remaining = tasks.length;
    let finished = false;
    let settleTimer;
    const items = () => {
      const seen = new Set();
      return groups.flatMap(group => group || []).filter(item => {
        if (!item?.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      resolve(items());
    };
    const deadline = setTimeout(finish, timeoutMs);
    if (!remaining) { finish(); return; }
    tasks.forEach((task, index) => {
      Promise.resolve(task).catch(() => []).then(group => {
        groups[index] = Array.isArray(group) ? group : [];
        remaining--;
        if (!remaining) { onComplete(items()); finish(); }
        else if (!finished && !settleTimer && groups[index].length) {
          settleTimer = setTimeout(finish, settleMs);
        }
      });
    });
  });
}
module.exports = { collectCatalogResults };
