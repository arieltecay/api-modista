import { rateLimit } from 'express-rate-limit';

/**
 * Rate limiters para endpoints públicos de escritura.
 *
 * Motivación: `POST /api/inscriptions*` crea inscripciones, dispara eventos
 * de Meta CAPI (Lead/InitiateCheckout) y genera preferences de MercadoPago.
 * Sin límite, bots/granjas de clicks ensucian la señal de optimización de Meta
 * (Leads falsos) y generan preferences basura. Con campañas pagas activas,
 * esto quema presupuesto directamente.
 *
 * Nota: `trust proxy` está habilitado en server.js, por lo que la key por IP
 * usa X-Forwarded-For correctamente detrás de Vercel/Cloudflare.
 */

// Inscripciones: un usuario legítimo crea 1-2 inscripciones. 10 en 15 min es generoso.
export const inscriptionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Demasiados intentos de inscripción. Esperá unos minutos y volvé a intentar.',
    },
});

// Telemetría del funnel: cada sesión genera ~10-15 eventos. 300/15min cubre
// navegación intensiva y frena floods automatizados.
export const telemetryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas solicitudes' },
});
