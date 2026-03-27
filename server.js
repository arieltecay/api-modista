import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes/index.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { logger } from './services/logger.js';
import connectDB from './config/db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

await connectDB();

const app = express();

const corsOptions = {
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Middleware para manejar la ruta raíz
app.get('/', (req, res) => {
  res.status(200).json({ message: 'API de Modista App funcionando correctamente' });
});

// Middleware para manejar solicitudes de favicon (cualquier extensión)
app.get(/^\/favicon\.(ico|png)$/, (req, res) => res.status(204).send());

// Usar Helmet para mejorar la seguridad de las cabeceras HTTP
app.use(helmet());

// Configuración de Mercado Pago
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    logger.error('Error: El Access Token de Mercado Pago no está configurado.');
    process.exit(1);
}

// Almacenamiento temporal para títulos de cursos (simula una sesión)
const courseTitles = {};
app.set('courseTitles', courseTitles);

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🚀 Servidor de API corriendo en http://localhost:${PORT}`);
});