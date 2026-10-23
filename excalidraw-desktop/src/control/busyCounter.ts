/**
 * The busy overlay for control calls: on while at least one call runs. A
 * counter, so overlapping calls never clear it while another is in flight.
 */
export const createBusyCounter = (setBusy: (busy: boolean) => void) => {
  let running = 0;
  return async <T>(run: () => Promise<T>): Promise<T> => {
    running += 1;
    if (running === 1) {
      setBusy(true);
    }
    try {
      return await run();
    } finally {
      running -= 1;
      if (running === 0) {
        setBusy(false);
      }
    }
  };
};
