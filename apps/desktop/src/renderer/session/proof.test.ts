import { describe, it, expect } from 'vitest';
import { computeCodeProof } from './proof.js';
import { connectionCodeProof } from '@rdp/protocol';

/**
 * The controller computes the code proof with Web Crypto; the host verifies with
 * node:crypto. They MUST produce byte-identical output or every coded connection
 * would fail. This test pins that cross-compatibility.
 */
describe('connection code proof: controller (WebCrypto) matches host (node)', () => {
  it('matches for several codes and sessions', async () => {
    // Codes are always non-empty (the UI and store reject blank codes).
    const cases = [
      ['hunter2', 'sess-1'],
      ['a longer pass phrase with spaces', 'abc-123-xyz'],
      ['🔐 unicode code', 'session-🙂'],
      ['1234', 'x'.repeat(120)],
    ];
    for (const [code, sid] of cases) {
      const controller = await computeCodeProof(code!, sid!);
      const host = connectionCodeProof(code!, sid!);
      expect(controller).toBe(host);
    }
  });

  it('differs when the session id differs (replay-bound)', async () => {
    const a = await computeCodeProof('code', 'sess-1');
    const b = await computeCodeProof('code', 'sess-2');
    expect(a).not.toBe(b);
  });
});
