/**
 * Siembra una landing de prueba en la DB de test para validar la landing v2.
 * Idempotente: hace upsert por slug.
 * Uso: node scripts/seed-landing-test.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../dist/config/db.js';
import LandingPage from '../dist/models/LandingPage.js';

await connectDB();

const doc = await LandingPage.findOneAndUpdate(
  { slug: 'test-v2' },
  {
    $set: {
      title: 'Landing de prueba E2E',
      slug: 'test-v2',
      courseId: '8f4b1562-89d5-4e5f-8ad2-7cae3b09c7b8',
      status: 'active',
      customTitle: 'Cosé tu primer tapado en 3 semanas, aunque nunca hayas tocado una máquina',
      customDescription: 'Método paso a paso con acompañamiento directo. Sin experiencia previa.',
      buttonText: 'QUIERO EMPEZAR AHORA',
    },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);

console.log('✓ Landing de prueba lista:', doc.slug, '→ courseId', doc.courseId);
await mongoose.disconnect();
process.exit(0);
