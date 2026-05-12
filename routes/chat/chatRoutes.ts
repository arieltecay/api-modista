import { Router } from 'express';
import * as chatController from '../../controllers/chat/chatController.js';
import * as botInstructionController from '../../controllers/chat/botInstructionController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

// Rutas de supervisión de chat
router.get('/', authenticateToken, chatController.getChats);
router.get('/:platform/:platform_id', authenticateToken, chatController.getMessagesByPlatform);
router.post('/:platform/:platform_id/messages', authenticateToken, chatController.sendMessage);
router.delete('/:platform/:platform_id/clear', authenticateToken, requireAdmin, chatController.clearChatHistory);
router.delete('/messages/:id', authenticateToken, requireAdmin, chatController.deleteMessage);

// Rutas de entrenamiento (Instrucciones)
router.get('/instructions', authenticateToken, botInstructionController.getInstructions);
router.post('/instructions', authenticateToken, requireAdmin, botInstructionController.createInstruction);
router.put('/instructions/:id', authenticateToken, requireAdmin, botInstructionController.updateInstruction);
router.delete('/instructions/:id', authenticateToken, requireAdmin, botInstructionController.deleteInstruction);

export default router;

