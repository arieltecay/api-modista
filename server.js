import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference } from 'mercadopago'; // Importa Mercado Pago
import routes from './routes/index.js'; // Importa las rutas consolidadas

// Cargar variables de entorno
dotenv.config();

const app = express();

// Configuración de Mercado Pago
const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    console.error('Error: El Access Token de Mercado Pago no está configurado.');
    process.exit(1);
}
const client = new MercadoPagoConfig({ accessToken });

// Almacenamiento temporal para títulos de cursos (simula una sesión)
const courseTitles = {};
app.set('courseTitles', courseTitles);

const corsOptions = {
    origin: process.env.CORS_ORIGIN,
    AccessControlAllowOrigin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    credentials: true,
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions));
app.use(express.json());

// Rutas principales
app.use('/api', routes); // Usamos las rutas consolidadas bajo /api

// Nueva ruta para crear preferencias de pago (integrada desde /api-mp)
app.post('/api/payment/create-preference', async (req, res) => {
    try {
        const { id, title, price, external_reference } = req.body;

        if (!id || !title || !price || isNaN(Number(price)) || !external_reference) {
            console.error('Datos inválidos recibidos:', req.body);
            return res.status(400).json({ error: 'Datos del producto inválidos o faltantes.' });
        }

        const preference = {
            items: [
                {
                    id: String(id),
                    title: String(title),
                    quantity: 1,
                    unit_price: Number(price),
                    currency_id: 'ARS',
                },
            ],
            external_reference: String(external_reference),
            back_urls: {
                success: `http://localhost:3001/api/payment/success`,
                failure: `http://localhost:5173/payment/failure`, // Mantener las URLs de fallo y pendiente en el frontend
                pending: `http://localhost:5173/payment/pending`,
            },
        };
        const pref = new Preference(client);
        const result = await pref.create({ body: preference });
        res.json({ id: result.id });
    } catch (error) {
        console.error('Error detallado al crear la preferencia:', JSON.stringify(error, null, 2));
        const errorMessage = error.cause?.[0]?.description || 'Error interno al crear la preferencia.';
        const statusCode = error.status || 500;
        res.status(statusCode).json({ error: errorMessage });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de API corriendo en http://localhost:${PORT}`);
});