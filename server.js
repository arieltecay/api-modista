import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import routes from './routes/index.js';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { logger } from './services/logger.js';
import connectDB from './config/db.js';
import { whatsappBot } from './services/whatsappBotService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http'; // Importar http
import { Server as SocketIOServer } from 'socket.io'; // Importar Server de socket.io

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const mongooseInstance = await connectDB();

// Pasar la instancia de mongoose al bot para cuando se necesite inicializar
whatsappBot.setMongoose(mongooseInstance);

const app = express();
const server = http.createServer(app); // Crear servidor HTTP

const corsOptions = {
    origin: [process.env.CORS_ORIGIN, process.env.URL_LOCAL],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
};

const io = new SocketIOServer(server, { cors: corsOptions }); // Conectar socket.io al servidor

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

// Servir archivos estáticos (ruta absoluta para el código QR)
app.use(express.static(path.join(__dirname, 'public')));

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

// Lógica de Socket.IO
const initializeSocket = (socketServer) => {
    socketServer.on('connection', (socket) => {
        logger.info(`🔌 Nuevo cliente conectado: ${socket.id}`);

        // Inyectar el socket en el servicio del bot
        whatsappBot.setSocket(socket);

        // Cuando el frontend solicita iniciar, comenzamos la inicialización del bot
        socket.on('init_whatsapp', () => {
            logger.info(`Evento 'init_whatsapp' recibido de ${socket.id}. Inicializando bot...`);
            whatsappBot.initialize(); // No es necesario pasar mongoose aquí si ya se estableció
        });

        socket.on('disconnect', () => {
            logger.info(`👋 Cliente desconectado: ${socket.id}`);
            // Opcional: podrías querer destruir la sesión del bot si el cliente se desconecta
            // whatsappBot.logout(); 
        });
    });
};

initializeSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { // Usar server.listen en lugar de app.listen
    logger.info(`🚀 Servidor de API corriendo con WebSockets en http://localhost:${PORT}`);
});