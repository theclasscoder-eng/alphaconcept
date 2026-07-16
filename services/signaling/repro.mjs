import { buildServer } from './src/server.ts';
const env = {
  APP_ENV:'test', LOG_LEVEL:'info', SIGNALING_PORT:0, SIGNALING_PUBLIC_URL:'ws://localhost',
  SIGNALING_STORE:'memory', SIGNALING_ALLOWED_ORIGINS:'*', DATABASE_URL:undefined,
  JWT_SECRET:'test-jwt-secret-value-1234567890', DEVICE_CHALLENGE_SECRET:'test-challenge-secret-1234567890',
  STUN_URL:'stun:stun.example.com:3478', TURN_URL:undefined, TURN_SHARED_SECRET:undefined, TURN_CREDENTIAL_TTL:3600,
};
const { app } = await buildServer(env);
await app.listen({ port:0, host:'127.0.0.1' });
const port = app.server.address().port;
console.log('listening on', port);
const WebSocket = (await import('ws')).default;
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
ws.on('open', ()=>console.log('OPEN'));
ws.on('message', d=>{ console.log('MSG', d.toString().slice(0,140)); process.exit(0); });
ws.on('error', e=>{ console.log('ERR', e.message); });
ws.on('close', (c,r)=>{ console.log('CLOSE', c, r.toString()); process.exit(3); });
setTimeout(()=>{ console.log('TIMEOUT no message'); process.exit(2); }, 3000);
