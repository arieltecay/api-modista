import mongoose from 'mongoose';
import { MongoStore } from 'wwebjs-mongo';
import pkg from 'whatsapp-web.js';
import chrome from 'chrome-aws-lambda';
import fs from 'fs';
const { Client, RemoteAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import { logger } from './logger.js';

/**
 * WhatsAppBotService
 * Maneja la conexión con WhatsApp Web y el envío de mensajes.
 * Implementado como Singleton para mantener una única conexión activa.
 */
class WhatsAppBotService {
    private static instance: WhatsAppBotService;
    public client: any | null; // Allow null
    public isReady: boolean = false;
    public lastQr: string | null = null;
    public status: 'disconnected' | 'initializing' | 'authenticating' | 'ready' | 'error' = 'disconnected'; // New status property
    private _mongooseInstance: typeof mongoose | null = null; // Added private property
    // private authPath: string = path.join(process.cwd(), '.wwebjs_auth'); // No longer needed with RemoteAuth

    private constructor() {
        this.client = null; // Initialize client to null
        // this._setupEvents(); // Moved to initialize()
    }

    public static getInstance(): WhatsAppBotService {
        if (!WhatsAppBotService.instance) {
            WhatsAppBotService.instance = new WhatsAppBotService();
        }
        return WhatsAppBotService.instance;
    }

    private _setupEvents() {
        this.client.on('qr', async (qr: string) => {
            logger.info('--- NUEVO CÓDIGO QR GENERADO ---');
            this.status = 'disconnected'; // Still disconnected, waiting for QR scan
            qrcodeTerminal.generate(qr, { small: true });

            // Convertir QR a Base64 para enviarlo directamente al front
            try {
                this.lastQr = await QRCode.toDataURL(qr);
                logger.info('QR convertido a Base64 y guardado en memoria');
            } catch (err) {
                logger.error('Error al generar Base64 del QR:', err);
            }
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.status = 'ready';
            this.lastQr = null; // Limpiar QR cuando ya está listo
            logger.info('✅ WhatsApp Bot está conectado y listo!');
        });

        this.client.on('authenticated', () => {
            logger.info('--- WhatsApp autenticado correctamente ---');
            this.status = 'authenticating'; // Authenticated, but waiting for ready
        });

        this.client.on('auth_failure', (msg: string) => {
            logger.error('--- Error de autenticación de WhatsApp:', msg);
            this.isReady = false;
            this.status = 'error';
        });

        this.client.on('disconnected', (reason: string) => {
            logger.warn('--- WhatsApp desconectado:', reason);
            this.isReady = false;
            this.status = 'disconnected';
            // Optional: Auto-reinitialize logic could go here, but for on-demand we might want manual trigger
        });
    }

    public async initialize(mongooseInstance?: typeof mongoose) { // Make argument optional
        // Prevent concurrent initialization if already in progress or ready
        if (this.status === 'initializing' || this.status === 'authenticating' || (this.isReady && this.client)) {
            logger.info(`WhatsApp Bot initialization skipped. Current status: ${this.status}`);
            return;
        }

        this.status = 'initializing';
        logger.info('Initializing WhatsApp Bot...');

        // Store mongoose instance if provided (first call)
        if (mongooseInstance) {
            this._mongooseInstance = mongooseInstance;
        } else if (!this._mongooseInstance) {
            // If no mongooseInstance provided and we don't have one, it's an error
            logger.error('Error: Mongoose instance not provided on first initialization.');
            this.status = 'error';
            throw new Error('Mongoose instance not provided for WhatsApp Bot initialization.');
        }

        try {
            fs.mkdirSync('/tmp/.cache/puppeteer', { recursive: true });
const store = new MongoStore({ mongoose: this._mongooseInstance! }); // Use stored instance

            // If client exists, destroy it first to ensure clean slate (e.g. on restart)
            if (this.client) {
                try {
                    await this.client.destroy();
                } catch (e) {
                    logger.warn('Error destroying existing client during re-initialization:', e);
                }
                this.client = null;
            }

            this.client = new Client({
                authStrategy: new RemoteAuth({
                    store: store,
                    clientId: 'modista_whatsapp_bot', // Un ID único para identificar esta sesión
                    backupSyncIntervalMs: 60000, // Frecuencia de guardado de la sesión en MongoDB (cada 1 minuto)
                    dataPath: '/tmp/.wwebjs_auth' // Usar un directorio temporal escribible en Vercel
                }),
                webVersion: '2.3000.1014111620',
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014111620.html',
                },
                puppeteer: {
                    headless: true,
                    executablePath: process.env.VERCEL ? await chrome.executablePath : undefined,
                    args: [
                        ...chrome.args, // Include default args from chrome-aws-lambda
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-gpu',
                        '--disable-dev-shm-usage', // Critical for serverless environments
                        '--no-zygote' // Helps with stability in some Linux envs
                    ],
                    defaultViewport: chrome.defaultViewport,
                    ignoreHTTPSErrors: true,
                }
            });

            // Re-setup events after client creation, as they bind to this.client
            this._setupEvents(); // Call again to bind events to the newly created client

            await this.client.initialize();
        } catch (err) {
            logger.error('Error al inicializar WhatsApp Bot:', err);
            this.status = 'error';
            this.isReady = false;
        }
    }

    /**
     * Formatea el número para WhatsApp Argentina.
     */
    private _formatNumber(number: string): string {
        let cleaned = number.replace(/\D/g, '');
        if (!cleaned.startsWith('54')) {
            cleaned = '549' + cleaned;
        } else if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
            cleaned = '549' + cleaned.substring(2);
        }
        return `${cleaned}@c.us`;
    }

    public async sendMessage(to: string, message: string) {
        if (!this.isReady || !this.client) { // Check this.client here as well
            throw new Error('El servicio de WhatsApp no está conectado. Por favor, escanea el QR en el servidor.');
        }
        const formattedId = this._formatNumber(to);
        return this.client.sendMessage(formattedId, message);
    }

}

export const whatsappBot = WhatsAppBotService.getInstance();
