function createSingleFlight(task) {
  let inFlight = null;

  return function (...args) {
    if (inFlight) return inFlight;

    const current = Promise.resolve().then(() => task(...args));

    inFlight = current.finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}

module.exports = { createSingleFlight };
