import type { RemoteDesktopApi } from '../shared-app/types';

declare global {
  interface Window {
    remoteDesktop: RemoteDesktopApi;
    rdIndicator: {
      onUpdate(cb: (info: { controllerName: string; unattended: boolean }) => void): () => void;
    };
  }
}

export {};
