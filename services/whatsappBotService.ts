import mongoose from 'mongoose';
import { MongoStore } from 'wwebjs-mongo';
import pkg from 'whatsapp-web.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import QRCode from 'qrcode';
import { logger } from './logger.js';
import { Socket } from 'socket.io'; // Importar Socket

const { Client, RemoteAuth } = pkg;

class WhatsAppBotService {
    private static instance: WhatsAppBotService;
    public client: any | null;
    public isReady: boolean = false;
    public status: 'disconnected' | 'initializing' | 'authenticating' | 'ready' | 'error' = 'disconnected';
    private socket: Socket | null = null; // Propiedad para el socket
    private _mongooseInstance: typeof mongoose | null = null;

    private constructor() {
        this.client = null;
    }

    public static getInstance(): WhatsAppBotService {
        if (!WhatsAppBotService.instance) {
            WhatsAppBotService.instance = new WhatsAppBotService();
        }
        return WhatsAppBotService.instance;
    }

    public setMongoose(mongooseInstance: typeof mongoose) {
        this._mongooseInstance = mongooseInstance;
    }

    // Nuevo método para inyectar el socket
    public setSocket(socket: Socket) {
        this.socket = socket;
    }

    private _setupEvents() {
        this.client.on('qr', async (qr: string) => {
            logger.info('--- NUEVO CÓDIGO QR GENERADO ---');
            this.status = 'authenticating'; // Esperando escaneo
            this.socket?.emit('status_update', { status: this.status, message: 'QR generado. Por favor, escanee.' });
            
            try {
                const qrDataURL = await QRCode.toDataURL(qr);
                // Enviar el QR directamente al cliente a través del socket
                this.socket?.emit('qr_code', qrDataURL);
                logger.info('QR enviado al cliente a través de WebSocket.');
            } catch (err) {
                logger.error('Error al generar o enviar el QR:', err);
                this.socket?.emit('status_update', { status: 'error', message: 'Error al generar el código QR.' });
            }
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.status = 'ready';
            logger.info('✅ WhatsApp Bot está conectado y listo!');
            // Notificar al cliente que el bot está listo
            this.socket?.emit('status_update', { status: this.status, message: 'WhatsApp conectado y listo.' });
        });

        this.client.on('authenticated', () => {
            logger.info('--- WhatsApp autenticado correctamente ---');
            this.status = 'authenticating';
            this.socket?.emit('status_update', { status: this.status, message: 'QR escaneado, autenticando...' });
        });
        
        this.client.on('auth_failure', (msg: string) => {
            logger.error('--- Error de autenticación de WhatsApp:', msg);
            this.isReady = false;
            this.status = 'error';
            this.socket?.emit('status_update', { status: this.status, message: `Error de autenticación: ${msg}` });
        });

        this.client.on('disconnected', (reason: string) => {
            logger.warn('--- WhatsApp desconectado:', reason);
            this.isReady = false;
            this.status = 'disconnected';
            this.socket?.emit('status_update', { status: this.status, message: `WhatsApp desconectado: ${reason}` });
            this.client = null; // Asegurarse de limpiar el cliente
        });
    }

    public async initialize() {
        if (this.status === 'initializing' || this.status === 'ready') {
            logger.info(`Inicialización de WhatsApp omitida. Estado actual: ${this.status}`);
            this.socket?.emit('status_update', { status: this.status, message: 'El bot ya está inicializado o en proceso.' });
            return;
        }

        this.status = 'initializing';
        logger.info('Initializing WhatsApp Bot...');
        this.socket?.emit('status_update', { status: this.status, message: 'Inicializando WhatsApp Bot...' });

        if (!this._mongooseInstance) {
            logger.error('Error: La instancia de Mongoose no ha sido proporcionada.');
            this.status = 'error';
            this.socket?.emit('status_update', { status: this.status, message: 'Error interno del servidor: Mongoose no configurado.' });
            return;
        }

        try {
            const store = new MongoStore({ mongoose: this._mongooseInstance! });

            if (this.client) {
                await this.client.destroy();
                this.client = null;
            }

            let executablePath = '';
            if (process.env.VERCEL) {
                executablePath = await chromium.executablePath();
                logger.info('Entorno Vercel: usando @sparticuz/chromium');
            } else {
                const commonPaths = [
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    '/usr/bin/google-chrome'
                ];
                executablePath = commonPaths.find(p => fs.existsSync(p)) || '';
                logger.info(`Entorno local: usando ${executablePath || 'Chrome detectado automáticamente'}`);
            }

            this.client = new Client({
                authStrategy: new RemoteAuth({
                    store: store,
                    clientId: 'modista_whatsapp_bot',
                    backupSyncIntervalMs: 60000,
                    dataPath: '/tmp/.wwebjs_auth'
                }),
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1014111620.html',
                },
                puppeteer: {
                    headless: process.env.VERCEL ? chromium.headless : true,
                    executablePath: executablePath || undefined,
                    args: process.env.VERCEL ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
                }
            });

            this._setupEvents();

            logger.info('Llamando a client.initialize()...');
            await this.client.initialize();
        } catch (err: any) { // Cambiado 'err' a 'err: any'
            logger.error('Error al inicializar WhatsApp Bot:', err);
            this.status = 'error';
            this.isReady = false;
            this.socket?.emit('status_update', { status: this.status, message: `Error en la inicialización: ${err.message}` });
        }
    }
    
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
        if (!this.isReady || !this.client) {
            this.socket?.emit('send_message_error', { message: 'El servicio de WhatsApp no está listo.' });
            throw new Error('El servicio de WhatsApp no está conectado.');
        }
        try {
            const formattedId = this._formatNumber(to);
            const result = await this.client.sendMessage(formattedId, message);
            this.socket?.emit('send_message_success', { to, messageId: result.id.id });
            return result;
        } catch (error: any) { // Cambiado 'error' a 'error: any'
            this.socket?.emit('send_message_error', { to, message: error.message });
            throw error;
        }
    }

    public async logout() {
        if (this.client) {
            await this.client.logout();
            logger.info('Sesión de WhatsApp cerrada (logout).');
            this.status = 'disconnected';
            this.isReady = false;
            this.socket?.emit('status_update', { status: this.status, message: 'Sesión cerrada.' });
        }
    }
}

export const whatsappBot = WhatsAppBotService.getInstance();

