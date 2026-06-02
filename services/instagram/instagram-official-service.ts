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

const API_VERSION = 'v25.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

let cachedPageId: string | null = null;

/**
 * Resuelve dinámicamente el ID de la página de Facebook asociada al token de acceso actual.
 * Esto es necesario cuando se utiliza un System User Token, ya que '/me' apunta al System User
 * y no soporta el endpoint de mensajería '/messages'.
 */
async function getPageId(accessToken: string): Promise<string> {
  // 1. Prioridad: Variable de entorno explícita
  if (process.env.META_PAGE_ID) {
    return process.env.META_PAGE_ID;
  }

  // 2. Caché en memoria
  if (cachedPageId) {
    return cachedPageId;
  }

  try {
    logger.info('[Instagram Service] Resolviendo PAGE_ID dinámicamente desde Meta Graph...');
    const response = await axios.get<{ data: Array<{ id: string; name: string }> }>(
      `${BASE_URL}/me/accounts`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.data?.data && response.data.data.length > 0) {
      cachedPageId = response.data.data[0].id;
      logger.info(`[Instagram Service] PAGE_ID resuelto con éxito: ${cachedPageId} (${response.data.data[0].name})`);
      return cachedPageId;
    }
  } catch (error: any) {
    logger.warn('[Instagram Service] Advertencia: No se pudo resolver PAGE_ID a través de /me/accounts, usando fallback:', error.message);
  }

  // 3. Fallback: Devolvemos 'me'
  return 'me';
}

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
  message: string,
  isAdminManual: boolean = false
): Promise<boolean> => {
  const creds = getCredentials();
  if (!creds) return false;

  const { ACCESS_TOKEN } = creds;
  const PAGE_ID = await getPageId(ACCESS_TOKEN);
  const API_URL = `${BASE_URL}/${PAGE_ID}/messages`;

  const postRequest = async (messagingType: 'RESPONSE' | 'MESSAGE_TAG', tag?: string) => {
    const payload: any = {
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: messagingType,
    };

    if (messagingType === 'MESSAGE_TAG' && tag) {
      payload.tag = tag;
    }

    return axios.post<{ message_id: string; recipient_id: string }>(
      API_URL,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  };

  try {
    // Si es un envio manual por el administrador, usamos HUMAN_AGENT directamente
    if (isAdminManual) {
      logger.info(`[Instagram Manual] Envío manual por Admin. Usando tag HUMAN_AGENT para ${recipientId}`);
      const response = await postRequest('MESSAGE_TAG', 'HUMAN_AGENT');
      logger.info(`[Instagram Manual OK] Mensaje manual enviado a ${recipientId}. ID: ${response.data.message_id}`);
      return true;
    }

    // Respuesta automatica (bot): intentamos de forma estandar RESPONSE
    try {
      const response = await postRequest('RESPONSE');
      logger.info(`[Instagram Bot OK] Mensaje bot enviado a ${recipientId}. ID: ${response.data.message_id}`);
      return true;
    } catch (apiError: any) {
      const metaError = apiError.response?.data?.error;
      const isWindowError = 
        metaError?.code === 10 || 
        metaError?.error_subcode === 2018307 || 
        String(metaError?.message).toLowerCase().includes('window');

      if (isWindowError) {
        logger.warn(`[Instagram Fallback] Ventana de 24h cerrada para ${recipientId}. Reintentando con tag HUMAN_AGENT...`);
        const fallbackResponse = await postRequest('MESSAGE_TAG', 'HUMAN_AGENT');
        logger.info(`[Instagram Fallback OK] Mensaje bot enviado con exito usando tag a ${recipientId}. ID: ${fallbackResponse.data.message_id}`);
        return true;
      }
      throw apiError;
    }
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

  const { ACCESS_TOKEN } = creds;
  const PAGE_ID = await getPageId(ACCESS_TOKEN);
  const API_URL = `${BASE_URL}/${PAGE_ID}/messages`;

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

  const { ACCESS_TOKEN } = creds;
  const PAGE_ID = await getPageId(ACCESS_TOKEN);

  try {
    await axios.post(
      `${BASE_URL}/${PAGE_ID}/messages`,
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
