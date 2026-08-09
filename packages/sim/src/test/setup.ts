import { beforeEach } from 'vitest';
import { initObs, resetObsForTests } from '../observability/hub.js';

/** Quiet observability for unit tests; reset between cases. */
beforeEach(() => {
  resetObsForTests();
  initObs({
    console: false,
    minLevel: 'error',
    systemTiming: true,
    traceSampleRate: 1,
  });
});
