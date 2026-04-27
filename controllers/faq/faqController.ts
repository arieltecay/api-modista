import { Request, Response } from 'express';
import FAQ from '../../models/FAQ.js';

/**
 * Get all active FAQs (Public)
 */
export const getActiveFAQs = async (req: Request, res: Response) => {
  try {
    const faqs = await FAQ.find({ status: 'active' }).sort({ order: 1 });
    res.json(faqs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get all FAQs (Admin)
 */
export const getAllFAQs = async (req: Request, res: Response) => {
  try {
    const faqs = await FAQ.find().sort({ order: 1 });
    res.json(faqs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Create a new FAQ
 */
export const createFAQ = async (req: Request, res: Response) => {
  try {
    const newFAQ = new FAQ(req.body);
    const savedFAQ = await newFAQ.save();
    res.status(201).json(savedFAQ);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Update an FAQ
 */
export const updateFAQ = async (req: Request, res: Response) => {
  try {
    const updatedFAQ = await FAQ.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedFAQ) return res.status(404).json({ message: 'FAQ not found' });
    res.json(updatedFAQ);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Delete an FAQ
 */
export const deleteFAQ = async (req: Request, res: Response) => {
  try {
    const deletedFAQ = await FAQ.findByIdAndDelete(req.params.id);
    if (!deletedFAQ) return res.status(404).json({ message: 'FAQ not found' });
    res.json({ message: 'FAQ deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
