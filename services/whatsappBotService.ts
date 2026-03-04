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
            this.lastQr = null; // Limpiar QR cuando ya está listo
            logger.info('✅ WhatsApp Bot está conectado y listo!');
        });

        this.client.on('authenticated', () => {
            logger.info('--- WhatsApp autenticado correctamente ---');
        });

        this.client.on('auth_failure', (msg: string) => {
            logger.error('--- Error de autenticación de WhatsApp:', msg);
            this.isReady = false;
        });

        this.client.on('disconnected', (reason: string) => {
            logger.warn('--- WhatsApp desconectado:', reason);
            this.isReady = false;
        });
    }

    public async initialize(mongooseInstance?: typeof mongoose) { // Make argument optional
        if (this.isReady && this.client) return; // Also check if client exists

        // Store mongoose instance if provided (first call)
        if (mongooseInstance) {
            this._mongooseInstance = mongooseInstance;
        } else if (!this._mongooseInstance) {
            // If no mongooseInstance provided and we don't have one, it's an error
            logger.error('Error: Mongoose instance not provided on first initialization.');
            throw new Error('Mongoose instance not provided for WhatsApp Bot initialization.');
        }

        try {
            fs.mkdirSync('/tmp/.cache/puppeteer', { recursive: true });
const store = new MongoStore({ mongoose: this._mongooseInstance! }); // Use stored instance

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
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        ...(chrome.args || [])
                    ],
                    defaultViewport: chrome.defaultViewport,
                    ignoreHTTPSErrors: true,
                    // Ensure cache directory is writable in Vercel
                    userDataDir: '/tmp/.wwebjs_auth',
                    // Puppeteer cache directory
                    // Note: chrome-aws-lambda handles its own cache, but set for safety
                    // (no direct option, but we can set env variable)
                }
            });

            // Re-setup events after client creation, as they bind to this.client
            this._setupEvents(); // Call again to bind events to the newly created client

            await this.client.initialize();
        } catch (err) {
            logger.error('Error al inicializar WhatsApp Bot:', err);
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
