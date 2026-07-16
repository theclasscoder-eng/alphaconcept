/**
 * Monitor enumeration for host mode. Combines Electron's `screen` display info
 * (bounds + DPI scale) with `desktopCapturer` sources (the media ids the
 * renderer uses to actually capture a screen via getUserMedia).
 */
import { desktopCapturer, screen } from 'electron';
import type { MonitorInfo } from '../shared-app/types.js';

export async function listMonitors(): Promise<MonitorInfo[]> {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });

  return displays.map((display, index) => {
    // desktopCapturer exposes display_id as a string that matches Electron's
    // display id. Fall back to positional matching if unavailable.
    const source =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[index] ?? sources[0];
    return {
      id: String(display.id),
      label: source?.id ?? `screen:${index}`,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      primary: display.id === primaryId,
    };
  });
}

export function getDisplayById(id: string): { bounds: Electron.Rectangle; scaleFactor: number } | null {
  const display = screen.getAllDisplays().find((d) => String(d.id) === id);
  if (!display) return null;
  return { bounds: display.bounds, scaleFactor: display.scaleFactor };
}
