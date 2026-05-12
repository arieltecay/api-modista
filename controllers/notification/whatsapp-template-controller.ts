import { Request, Response } from 'express';
import { 
  getWhatsAppTemplates, 
  createWhatsAppTemplate, 
  deleteWhatsAppTemplate,
  sendWhatsAppTemplate
} from '../../services/whatsapp-official-service.js';

/**
 * Controller for managing WhatsApp Message Templates
 */

export const getTemplates = async (req: Request, res: Response) => {
  try {
    const templates = await getWhatsAppTemplates();
    res.status(200).json(templates);
  } catch (error: any) {
    res.status(500).json({ error: 'Error fetching templates from Meta' });
  }
};

export const createTemplate = async (req: Request, res: Response) => {
  try {
    const result = await createWhatsAppTemplate(req.body);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.response?.data || 'Error creating template in Meta' });
  }
};

export const deleteTemplate = async (req: Request, res: Response) => {
  const { name } = req.params;
  try {
    const result = await deleteWhatsAppTemplate(name as string);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(400).json({ error: 'Error deleting template from Meta' });
  }
};

export const sendTestTemplate = async (req: Request, res: Response) => {
  const { to, templateName, components, languageCode } = req.body;
  try {
    const success = await sendWhatsAppTemplate(to, templateName, components, languageCode || 'es_AR');
    if (success) {
      res.status(200).json({ message: 'Template sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send template' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
