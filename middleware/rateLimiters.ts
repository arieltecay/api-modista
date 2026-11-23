import { rateLimit } from 'express-rate-limit';
import { MongoRateLimitStore } from './mongoRateLimitStore.js';

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
    // Contadores en Mongo: en serverless cada instancia tiene su propia memoria y el tope real sería mayor.
    store: new MongoRateLimitStore({ prefix: 'inscriptions' }),
    passOnStoreError: true,
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

// Telemetría de adquisición: visita + eventos + señales de Pixel por sesión (~40 requests);
// 600/15min tolera NAT móvil compartido y frena floods.
export const acquisitionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas solicitudes' },
});

// Página pública de la factura: se abre desde el mail (pocas veces por persona); frena el barrido de tokens.
export const invoiceViewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas solicitudes' },
});

// Verificación pública de cupones: solo cuentan los intentos fallidos (un cupón válido no gasta intentos);
// el tope frena la enumeración de códigos. Contadores en Mongo para que valga en todas las instancias.
export const couponValidateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: new MongoRateLimitStore({ prefix: 'coupon-validate' }),
    passOnStoreError: true,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.locals.couponValid === true,
    message: { success: false, message: 'Demasiados intentos, esperá unos minutos' },
});

// Reintento de pago: cada llamada puede renovar la reserva de un cupón y crea una preferencia en MercadoPago.
export const paymentRetryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new MongoRateLimitStore({ prefix: 'payment-retry' }),
    passOnStoreError: true,
    message: { success: false, message: 'Demasiados intentos, esperá unos minutos' },
});

// «¿Mostrar el campo de cupón?»: se pregunta al abrir el formulario de un curso; el tope frena el barrido por scripts.
export const couponAvailabilityLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    store: new MongoRateLimitStore({ prefix: 'coupon-availability' }),
    passOnStoreError: true,
    message: { success: false, message: 'Demasiadas solicitudes, esperá unos minutos' },
});
