import { Request, Response, NextFunction } from 'express';
import CarouselService from '../../services/carousel/carousel-service.js';
import { createSlideSchema, updateSlideSchema, reorderSlidesSchema } from './types.js';
import { ValidationError, EntityNotFoundError } from '../../utils/errors.js';

class CarouselController {
  async getAllSlides(req: Request, res: Response, next: NextFunction) {
    try {
      const slides = await CarouselService.getAllSlides();
      res.status(200).json(slides);
    } catch (error) {
      next(error);
    }
  }

  async getActiveSlides(req: Request, res: Response, next: NextFunction) {
    try {
      const slides = await CarouselService.getActiveSlides();
      res.status(200).json(slides);
    } catch (error) {
      next(error);
    }
  }

  async createSlide(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = createSlideSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError(validation.error.message);
      }
      
      const newSlide = await CarouselService.createSlide({
        ...validation.data,
        publishAt: validation.data.publishAt ? new Date(validation.data.publishAt) : undefined,
        expireAt: validation.data.expireAt ? new Date(validation.data.expireAt) : undefined
      });
      res.status(201).json(newSlide);
    } catch (error) {
      next(error);
    }
  }

  async updateSlide(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const validation = updateSlideSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError(validation.error.message);
      }

      const updatedSlide = await CarouselService.updateSlide(id, {
        ...validation.data,
        publishAt: validation.data.publishAt ? new Date(validation.data.publishAt) : undefined,
        expireAt: validation.data.expireAt ? new Date(validation.data.expireAt) : undefined
      });
      
      if (!updatedSlide) {
        throw new EntityNotFoundError('Slide no encontrado');
      }
      
      res.status(200).json(updatedSlide);
    } catch (error) {
      next(error);
    }
  }

  async deleteSlide(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const deletedSlide = await CarouselService.deleteSlide(id);
      
      if (!deletedSlide) {
        throw new EntityNotFoundError('Slide no encontrado');
      }
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async reorderSlides(req: Request, res: Response, next: NextFunction) {
    try {
      const validation = reorderSlidesSchema.safeParse(req.body);
      if (!validation.success) {
        throw new ValidationError(validation.error.message);
      }
      
      await CarouselService.reorderSlides(validation.data);
      res.status(200).json({ message: 'Slides reordenados correctamente' });
    } catch (error) {
      next(error);
    }
  }
}

export default new CarouselController();
