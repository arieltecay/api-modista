import axios from 'axios';
import ConversationMessage from '../../models/ConversationMessage.js';
import { logger } from '../logger.js';
import { 
  InstagramSendMessageRequest, 
  InstagramMessageTag 
} from '../../types/instagram-official.js';

/**
 * Instagram Messaging Service (Meta Graph API)
 * 
 * Usa un token de página de Facebook con permisos:
 * - instagram_basic
 * - instagram_manage_messages
 * - pages_manage_metadata
 */

const API_VERSION = 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

/**
 * Obtiene las credenciales de Instagram desde las variables de entorno
 */
function getCredentials() {
  const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const IG_USER_ID = process.env.META_INSTAGRAM_USER_ID;

  if (!ACCESS_TOKEN || !IG_USER_ID) {
    logger.error('[Instagram] Credenciales faltantes en variables de entorno');
    return null;
  }

  return { ACCESS_TOKEN, IG_USER_ID };
}

/**
 * Envía un mensaje de texto a un usuario de Instagram
 * 
 * @param recipientId - ID del usuario de Instagram (scoped)
 * @param message     - Contenido del mensaje
 * @returns boolean   - true si se envió correctamente
 */
export const sendInstagramMessage = async (
  recipientId: string, 
  message: string
): Promise<boolean> => {
  const creds = getCredentials();
  if (!creds) return false;

  const { ACCESS_TOKEN, IG_USER_ID } = creds;
  const API_URL = `${BASE_URL}/${IG_USER_ID}/messages`;

  try {
    const response = await axios.post<{ message_id: string; recipient_id: string }>(
      API_URL,
      {
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: 'RESPONSE',
      } as InstagramSendMessageRequest,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(
      `[Instagram OK] Mensaje enviado a ${recipientId}. ID: ${response.data.message_id}`
    );

    // Persistir el mensaje saliente en la base de datos
    try {
      await ConversationMessage.create({
        platform: 'instagram',
        platform_id: recipientId,
        body: message,
        direction: 'outbound',
        status: 'sent',
        isAdminRead: true,
      });
    } catch (dbError: any) {
      logger.error('[Instagram Error] Fallo al persistir mensaje saliente:', {
        error: dbError.message,
      });
    }

    return true;
  } catch (error: any) {
    logger.error('[Instagram Error] Detalle API Meta:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    return false;
  }
};

/**
 * Envía un mensaje con tag (para comunicación fuera de la ventana de 24h)
 * 
 * @param recipientId - ID del usuario de Instagram
 * @param message     - Contenido del mensaje
 * @param tag         - Tag permitido por Meta
 * @returns boolean   - true si se envió correctamente
 */
export const sendInstagramTaggedMessage = async (
  recipientId: string,
  message: string,
  tag: InstagramMessageTag = 'HUMAN_AGENT'
): Promise<boolean> => {
  const creds = getCredentials();
  if (!creds) return false;

  const { ACCESS_TOKEN, IG_USER_ID } = creds;
  const API_URL = `${BASE_URL}/${IG_USER_ID}/messages`;

  try {
    const response = await axios.post(
      API_URL,
      {
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: 'MESSAGE_TAG',
        tag,
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info(
      `[Instagram Tagged OK] Mensaje tag=${tag} enviado a ${recipientId}`
    );

    await ConversationMessage.create({
      platform: 'instagram',
      platform_id: recipientId,
      body: message,
      direction: 'outbound',
      status: 'sent',
    });

    return true;
  } catch (error: any) {
    logger.error('[Instagram Tagged Error]:', {
      status: error.response?.status,
      data: error.response?.data,
    });
    return false;
  }
};

/**
 * Marca un mensaje como leído en Instagram
 * 
 * @param recipientId - ID del usuario
 */
export const markInstagramMessageRead = async (
  recipientId: string
): Promise<boolean> => {
  const creds = getCredentials();
  if (!creds) return false;

  const { ACCESS_TOKEN, IG_USER_ID } = creds;

  try {
    await axios.post(
      `${BASE_URL}/${IG_USER_ID}/messages`,
      {
        recipient: { id: recipientId },
        sender_action: 'mark_seen',
      },
      {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      }
    );
    return true;
  } catch (error: any) {
    logger.error('[Instagram Error] Fallo al marcar como leído:', error.message);
    return false;
  }
};

/**
 * Obtiene información del perfil de un usuario de Instagram
 * 
 * @param instagramScopedId - ID scoped del usuario
 * @returns perfil del usuario o null
 */
export const getInstagramUserProfile = async (
  instagramScopedId: string
): Promise<{ name: string; username: string } | null> => {
  const creds = getCredentials();
  if (!creds) return null;

  const { ACCESS_TOKEN } = creds;

  try {
    const response = await axios.get(`${BASE_URL}/${instagramScopedId}`, {
      params: {
        fields: 'name,username,profile_pic',
        access_token: ACCESS_TOKEN,
      },
    });

    return {
      name: response.data.name,
      username: response.data.username,
    };
  } catch (error: any) {
    logger.error('[Instagram Error] Fallo al obtener perfil:', error.message);
    return null;
  }
};
