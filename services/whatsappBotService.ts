import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
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
    public client: any;
    public isReady: boolean = false;
    public lastQr: string | null = null;
    private authPath: string = path.join(process.cwd(), '.wwebjs_auth');

    private constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: this.authPath
            }),
            webVersion: '2.3000.1014111620',
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014111620.html',
            },
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                ]
            }
        });

        this._setupEvents();
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

    public async initialize() {
        if (this.isReady) return;
        try {
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
        if (!this.isReady) {
            throw new Error('El servicio de WhatsApp no está conectado. Por favor, escanea el QR en el servidor.');
        }
        const formattedId = this._formatNumber(to);
        return this.client.sendMessage(formattedId, message);
    }
}

export const whatsappBot = WhatsAppBotService.getInstance();
