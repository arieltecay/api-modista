import { Request, Response } from 'express';
import BotInstruction from '../../models/BotInstruction.js';

/**
 * Obtener todas las instrucciones del bot ordenadas
 */
export const getInstructions = async (req: Request, res: Response) => {
  try {
    const instructions = await BotInstruction.find().sort({ order: 1 });
    res.json(instructions);
  } catch (error: any) {
    res.status(500).json({ message: 'Error al obtener instrucciones', error: error.message });
  }
};

/**
 * Crear una nueva instrucción
 */
export const createInstruction = async (req: Request, res: Response) => {
  try {
    const { title, content, order, isActive } = req.body;
    const newInstruction = new BotInstruction({ title, content, order, isActive });
    await newInstruction.save();
    res.status(201).json(newInstruction);
  } catch (error: any) {
    res.status(400).json({ message: 'Error al crear instrucción', error: error.message });
  }
};

/**
 * Actualizar una instrucción existente
 */
export const updateInstruction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, order, isActive } = req.body;
    
    const updatedInstruction = await BotInstruction.findByIdAndUpdate(
      id,
      { title, content, order, isActive },
      { new: true, runValidators: true }
    );

    if (!updatedInstruction) {
      return res.status(404).json({ message: 'Instrucción no encontrada' });
    }

    res.json(updatedInstruction);
  } catch (error: any) {
    res.status(400).json({ message: 'Error al actualizar instrucción', error: error.message });
  }
};

/**
 * Eliminar una instrucción
 */
export const deleteInstruction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deletedInstruction = await BotInstruction.findByIdAndDelete(id);

    if (!deletedInstruction) {
      return res.status(404).json({ message: 'Instrucción no encontrada' });
    }

    res.json({ message: 'Instrucción eliminada correctamente' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error al eliminar instrucción', error: error.message });
  }
};
