/**
 * Compute the per-connection code proof in the renderer (controller side) using
 * Web Crypto. Must match the host's node computation exactly:
 *   proof = hex( HMAC-SHA256(key = code, msg = sessionId) )
 * The code itself is never sent — only this session-bound proof.
 */
export async function computeCodeProof(code: string, sessionId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(code),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(sessionId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
