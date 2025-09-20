/**
 * Script para crear un curso de prueba
 * Ejecutar con: node seed-course.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Conectar a MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/modista-app');
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }
};

// Modelo de Course (simplificado)
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  shortDescription: { type: String, required: true },
  longDescription: { type: String, required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  deeplink: { type: String },
  videoUrl: { type: String },
}, {
  timestamps: true
});

const Course = mongoose.model('Course', courseSchema);

// Datos del curso de prueba
const testCourse = {
  title: 'Curso de Costura Básica - Prueba',
  shortDescription: 'Aprende los fundamentos de la costura con técnicas básicas y proyectos prácticos.',
  longDescription: 'Este curso completo te enseñará desde cero todo lo que necesitas saber sobre costura. Comenzaremos con los conceptos básicos, herramientas necesarias y terminaremos con proyectos prácticos que podrás aplicar en tu día a día. Incluye videos explicativos, guías paso a paso y soporte personalizado.',
  imageUrl: '/images/costuraMujer.jpeg',
  category: 'Costura Básica',
  price: 2500,
  deeplink: 'https://wa.me/5491234567890?text=Hola,%20me%20interesa%20el%20curso%20de%20costura%20básica',
  videoUrl: 'https://youtube.com/watch?v=example'
};

// Función principal
const seedCourse = async () => {
  try {
    await connectDB();

    // Verificar si ya existe un curso de prueba
    const existingCourse = await Course.findOne({ title: testCourse.title });
    if (existingCourse) {
      console.log('El curso de prueba ya existe:', existingCourse._id);
      process.exit(0);
    }

    // Crear el curso
    const course = await Course.create(testCourse);
    console.log('Curso de prueba creado exitosamente:');
    console.log('- ID:', course._id);
    console.log('- Título:', course.title);
    console.log('- Precio:', course.price);

    process.exit(0);
  } catch (error) {
    console.error('Error creando curso de prueba:', error);
    process.exit(1);
  }
};

// Ejecutar el script
seedCourse();