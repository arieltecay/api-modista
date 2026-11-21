/**
 * Validación local del bot de Instagram contra la BD de `.env` (dev).
 * - Firma los webhooks con un secreto de prueba (no usa el real) y llama al controller real.
 * - Graph está SIMULADO: nunca se envía un DM real. Gemini es real si hay GEMINI_API_KEY (o `--mock-gemini`).
 * - Todo lo que crea lleva el prefijo `local-test` / `[LOCAL-TEST]` y se borra al terminar.
 * Uso: npm run test:local:instagram [-- --mock-gemini]
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import axios from 'axios';
import mongoose from 'mongoose';

const SECRET = 'local-test-secret';
process.env.META_INSTAGRAM_APP_SECRET = SECRET;
process.env.META_INSTAGRAM_ACCESS_TOKEN = 'local-test-token';
process.env.META_INSTAGRAM_USER_ID = 'local-test-business';

const mockGemini = process.argv.includes('--mock-gemini') || !process.env.GEMINI_API_KEY;
const TAG = '[LOCAL-TEST]';
const PREFIX = 'local-test-';
const EMAIL = `${PREFIX}${Date.now()}@example.com`;

const { default: connectDB } = await import('../dist/config/db.js');
const { handleWebhook } = await import('../dist/controllers/notification/instagram-controller.js');
const { default: BotInstruction } = await import('../dist/models/BotInstruction.js');
const { default: BotWebhookEvent } = await import('../dist/models/BotWebhookEvent/index.js');
const { default: ConversationMessage } = await import('../dist/models/ConversationMessage.js');
const { default: Inscription } = await import('../dist/models/Inscription.js');
const { default: BotLookupAttempt } = await import('../dist/models/BotLookupAttempt/index.js');

await connectDB();
if (!/test|dev|local|staging/i.test(mongoose.connection.name)) {
  console.error(`Abortado: la BD "${mongoose.connection.name}" no parece de desarrollo (debe contener test, dev, local o staging).`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`BD: ${mongoose.connection.name} | Gemini: ${mockGemini ? 'simulado' : 'real'} | Graph: simulado\n`);

const network = { gemini: [], graph: [], graphFails: false };
const realPost = axios.post.bind(axios);
axios.post = async (url, payload, config) => {
  if (String(url).includes('graph.instagram.com')) {
    network.graph.push(payload);
    if (network.graphFails) throw Object.assign(new Error('Graph simulado caído'), { response: { status: 500 } });
    return { data: { message_id: 'local-out', recipient_id: 'x' } };
  }
  if (String(url).includes('generativelanguage.googleapis.com')) {
    network.gemini.push(payload);
    if (mockGemini) return { data: { candidates: [{ content: { parts: [{ text: 'Respuesta de IA (simulada)' }] } }] } };
  }
  return realPost(url, payload, config);
};

const cleanup = async () => {
  await Promise.all([
    BotInstruction.deleteMany({ title: new RegExp(`^${TAG.replace(/[[\]]/g, '\\$&')}`) }),
    BotWebhookEvent.deleteMany({ messageId: new RegExp(`^${PREFIX}`) }),
    ConversationMessage.deleteMany({ platform: 'instagram', platform_id: new RegExp(`^${PREFIX}`) }),
    Inscription.deleteMany({ email: new RegExp(`^${PREFIX}`) }),
    BotLookupAttempt.deleteMany({ platformId: new RegExp(`^${PREFIX}`) }),
  ]);
};

const reset = async () => {
  network.gemini = [];
  network.graph = [];
  network.graphFails = false;
  await cleanup();
};

let seq = 0;
const send = async ({ text, mid = `${PREFIX}mid-${Date.now()}-${seq++}`, sender = `${PREFIX}user`, secret = SECRET }) => {
  const raw = Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ id: 'local-test-business', time: 1, messaging: [{ sender: { id: sender }, recipient: { id: 'local-test-business' }, timestamp: 1, message: { mid, text } }] }] }));
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const req = { body: JSON.parse(raw.toString()), rawBody: raw, headers: { 'x-hub-signature-256': signature }, get: () => undefined };
  let status = 200;
  const res = { status(code) { status = code; return res; }, send() { return res; }, sendStatus(code) { status = code; return res; } };
  await handleWebhook(req, res);
  return { status, mid };
};

const addBlock = (overrides) => BotInstruction.create({ title: `${TAG} bloque`, content: 'Contenido de prueba', order: 9000, isActive: true, instagramAutoReply: true, instagramKeywords: ['zzcamisa'], ...overrides });
const countMessages = (filter) => ConversationMessage.countDocuments({ platform: 'instagram', platform_id: new RegExp(`^${PREFIX}`), ...filter });

let failed = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failed += 1;
  console.log(`${condition ? '✓' : '✗'} ${name}${condition ? '' : ` ${detail}`}`);
};

const cases = [
  ['firma correcta se acepta y firma de otra app se rechaza', async () => {
    check('firma válida → 200', (await send({ text: 'hola' })).status === 200);
    check('firma de otro secreto → 401', (await send({ text: 'hola', secret: 'otro-secreto' })).status === 401);
  }],
  ['sin bloques activados para Instagram no responde', async () => {
    await BotInstruction.create({ title: `${TAG} apagado`, content: 'x', order: 9000, isActive: true, instagramKeywords: ['zzcamisa'] });
    check('responde 200', (await send({ text: 'info zzcamisa' })).status === 200);
    check('no llama a Gemini ni a Graph', network.gemini.length === 0 && network.graph.length === 0);
    check('guarda el entrante', (await countMessages({ direction: 'inbound' })) === 1);
  }],
  ['un bloque coincidente responde una vez y no filtra otros bloques', async () => {
    await addBlock({ content: 'Dictamos camisas los sábados' });
    await addBlock({ title: `${TAG} otro`, content: 'SECRETO-NO-COINCIDENTE', instagramKeywords: ['zzfalda'] });
    await send({ text: 'info zzcamisa' });
    const prompt = JSON.stringify(network.gemini);
    check('envía una respuesta por Graph', network.graph.length === 1);
    check('el prompt incluye el bloque coincidente', /sábados/.test(prompt));
    check('el prompt NO incluye el bloque no coincidente', !/SECRETO-NO-COINCIDENTE/.test(prompt));
    check('guarda entrante y saliente', (await countMessages({ direction: 'inbound' })) === 1 && (await countMessages({ direction: 'outbound' })) === 1);
  }],
  ['reintento tras fallo de Graph: 500 y luego una sola respuesta', async () => {
    await addBlock({});
    network.graphFails = true;
    const first = await send({ text: 'info zzcamisa', mid: `${PREFIX}retry` });
    check('Graph caído → 500', first.status === 500);
    network.graphFails = false;
    const second = await send({ text: 'info zzcamisa', mid: `${PREFIX}retry` });
    const third = await send({ text: 'info zzcamisa', mid: `${PREFIX}retry` });
    check('reintento → 200', second.status === 200 && third.status === 200);
    check('un solo entrante y una sola respuesta guardada', (await countMessages({ direction: 'inbound' })) === 1 && (await countMessages({ direction: 'outbound' })) === 1);
  }],
  ['tras 3 fallos el mensaje se descarta', async () => {
    await addBlock({});
    network.graphFails = true;
    const statuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) statuses.push((await send({ text: 'info zzcamisa', mid: `${PREFIX}dead` })).status);
    const sentBefore = network.graph.length;
    const fourth = await send({ text: 'info zzcamisa', mid: `${PREFIX}dead` });
    check('3 intentos → 500', statuses.every((status) => status === 500));
    check('el cuarto devuelve 200 sin enviar', fourth.status === 200 && network.graph.length === sentBefore);
  }],
  ['consulta de inscripción: solo curso y estado', async () => {
    await addBlock({ instagramKeywords: ['zzinscripto'], instagramEnrollmentLookup: true });
    await Inscription.create({ nombre: 'Prueba', apellido: 'Local', email: EMAIL, celular: '+54 9 381 700 0001', courseId: 'local-test', courseTitle: 'Curso de prueba', coursePrice: 123456, paymentStatus: 'paid' });
    await send({ text: `Mi inscripción (zzinscripto): ${EMAIL}, celular 381 700 0001` });
    const reply = network.graph[0]?.message?.text ?? '';
    check('responde con curso y estado', /Curso de prueba: figura como pagada/.test(reply), reply);
    check('no expone email, teléfono, apellido ni precio', !/example\.com|700 0001|Local|123456/.test(reply));
    check('no pasa por Gemini', network.gemini.length === 0);
  }],
  ['sin el flag de consulta no se exponen datos guardados', async () => {
    await addBlock({ instagramKeywords: ['zzinscripto'], instagramEnrollmentLookup: false });
    await Inscription.create({ nombre: 'Prueba', apellido: 'Local', email: EMAIL, celular: '+54 9 381 700 0001', courseId: 'local-test', courseTitle: 'Curso de prueba', coursePrice: 123456, paymentStatus: 'paid' });
    await send({ text: `Mi inscripción (zzinscripto): ${EMAIL}, celular 381 700 0001` });
    check('el prompt no contiene datos de la inscripción', !/Curso de prueba|figura como pagada/.test(JSON.stringify(network.gemini)));
  }],
  ['bloque con consulta igual responde otras preguntas con Gemini', async () => {
    await addBlock({ instagramEnrollmentLookup: true });
    await send({ text: '¿Cuándo empieza el curso de zzcamisa?' });
    check('Gemini respondió y se envió por Graph', network.gemini.length === 1 && network.graph.length === 1);
  }],
];

try {
  for (const [name, run] of cases) {
    console.log(`\n# ${name}`);
    await reset();
    try {
      await run();
    } catch (error) {
      failed += 1;
      console.log(`✗ excepción inesperada: ${error instanceof Error ? error.message : error}`);
    }
  }
} finally {
  await cleanup();
  await mongoose.disconnect();
}

console.log(failed === 0 ? '\nTodas las validaciones pasaron.' : `\n${failed} validación(es) fallaron.`);
process.exit(failed === 0 ? 0 : 1);
