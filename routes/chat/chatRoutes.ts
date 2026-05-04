import { Router } from 'express';
import * as chatController from '../../controllers/chat/chatController.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

const router = Router();

router.get('/', authenticateToken, chatController.getChats);
router.get('/:platform/:platform_id', authenticateToken, chatController.getMessagesByPlatform);
router.post('/:platform/:platform_id/messages', authenticateToken, chatController.sendMessage);

export default router;

