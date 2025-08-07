import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from 'mercadopago'; // Importa Mercado Pago
import routes from './routes/index.js'; // Importa las rutas consolidadas
import cookieParser from 'cookie-parser';
import helmet from 'helmet'; // Importa Helmet
import { logger } from './services/logger.js'; // Importa el logger

// Cargar variables de entorno
dotenv.config();

const app = express();

// Usar Helmet para mejorar la seguridad de las cabeceras HTTP
app.use(helmet());

// Configuración de Mercado Pago
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    logger.error('Error: El Access Token de Mercado Pago no está configurado.');
    process.exit(1);
}
const client = new MercadoPagoConfig({ accessToken });

// Almacenamiento temporal para títulos de cursos (simula una sesión)
const courseTitles = {};
app.set('courseTitles', courseTitles);

const corsOptions = {
    origin: [process.env.CORS_ORIGIN, process.env.URL_LOCAL],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🚀 Servidor de API corriendo en http://localhost:${PORT}`);
});