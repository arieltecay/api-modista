import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from 'mercadopago'; // Importa Mercado Pago
import routes from './routes/index.js'; // Importa las rutas consolidadas
import cookieParser from 'cookie-parser';
import helmet from 'helmet'; // Importa Helmet
import { logger } from './services/logger.js'; // Importa el logger
import connectDB from './config/db.js'; // Importa la función de conexión a la BD
import { whatsappBot } from './services/whatsappBotService.js'; // Importa el bot
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

connectDB();

// Inicializar WhatsApp Bot
whatsappBot.initialize();

const app = express();

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

const corsOptions = {
    origin: [process.env.CORS_ORIGIN, process.env.URL_LOCAL],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Servir archivos estáticos (ruta absoluta para el código QR)
app.use(express.static(path.join(__dirname, 'public')));

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🚀 Servidor de API corriendo en http://localhost:${PORT}`);
});