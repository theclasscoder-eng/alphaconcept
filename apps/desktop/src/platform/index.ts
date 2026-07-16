import type { InputInjector } from './types.js';
import { NoopInputInjector } from './noopInput.js';

export type { InputInjector } from './types.js';

/**
 * Create the platform input injector. On Windows we try nut-js first and fall
 * back to a no-op injector (with the error surfaced) if the native module is
 * unavailable. Non-Windows platforms currently get the no-op injector.
 */
export async function createInputInjector(): Promise<{
  injector: InputInjector;
  error: string | null;
}> {
  if (process.platform === 'win32') {
    try {
      const { NutInputInjector } = await import('./windows/nutInput.js');
      const injector = await NutInputInjector.create();
      return { injector, error: null };
    } catch (err) {
      return { injector: new NoopInputInjector(), error: `nut-js unavailable: ${String(err)}` };
    }
  }
  return { injector: new NoopInputInjector(), error: 'input injection not implemented on this OS' };
}
