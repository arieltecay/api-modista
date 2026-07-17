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
    origin: function (origin, callback) {
        const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [];
        // Permitir peticiones sin origen (como apps móviles o curl) o si el origen está en la lista
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Middleware para manejar la ruta raíz
app.get('/', (req, res) => {
  res.status(200).json({ message: 'API de Modista App funcionando correctamente' });
});

// Silenciar peticiones de Socket.io residuales (evita 404 en logs de Vercel)
app.all(/^\/socket\.io.*/, (req, res) => {
    res.status(204).end();
});

// Middleware para robots.txt - Mejora reputación ante Meta/Google bots
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send("User-agent: *\nDisallow: /api/\nDisallow: /config/\nAllow: /");
});

// Middleware para manejar solicitudes de favicon (cualquier extensión)
app.get(/^\/favicon\.(ico|png)$/, (req, res) => res.status(204).send());

// Usar Helmet para mejorar la seguridad de las cabeceras HTTP
app.use(helmet());

// Configuración de Mercado Pago
// No matamos el proceso si falta el token: la ruta del webhook responde 503
// y createPreference devuelve 503. Permite deploys sin MP configurado.
if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
    logger.warn('MERCADO_PAGO_ACCESS_TOKEN no está configurado. Las rutas de pago no funcionarán hasta configurarlo.');
}

// Almacenamiento temporal para títulos de cursos (simula una sesión)
const courseTitles = {};
app.set('courseTitles', courseTitles);

app.use(cors(corsOptions));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(cookieParser());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

// Manejador de rutas no encontradas (404)
app.use((req, res, next) => {
    const context = {
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
        method: req.method,
        url: req.originalUrl
    };
    logger.warn(`Ruta no encontrada (404): ${req.method} ${req.originalUrl}`, context);
    res.status(404).json({
        success: false,
        message: `La ruta ${req.originalUrl} no existe en este servidor.`
    });
});

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
    const errorContext = {
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        method: req.method,
        url: req.originalUrl,
        query: req.query,
        // Evitamos loguear bodies extremadamente pesados o sensibles si fuera necesario, 
        // pero para debugging de 4xx/5xx es vital.
        body: req.method !== 'GET' ? req.body : undefined,
        stack: err.stack
    };

    logger.error(`Error no manejado: ${err.message}`, errorContext);
    
    if (err instanceof Error && (err.name === 'MulterError' || err.message.includes('Formato de archivo'))) {
        return res.status(400).json({ 
            success: false, 
            message: err.message 
        });
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error interno del servidor'
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🚀 Servidor de API corriendo en http://localhost:${PORT}`);
});