import CarouselConfig, { ICarouselConfig } from '../../models/carousel-config-model.js';
import { CreateCarouselSlideDTO, UpdateCarouselSlideDTO, ReorderSlidesDTO } from './types.js';

class CarouselService {
  async getAllSlides(): Promise<ICarouselConfig[]> {
    return CarouselConfig.find().sort({ order: 1 });
  }

  async getActiveSlides(): Promise<ICarouselConfig[]> {
    const now = new Date();
    return CarouselConfig.find({
      isActive: true,
      $and: [
        { $or: [{ publishAt: { $exists: false } }, { publishAt: null }, { publishAt: { $lte: now } }] },
        { $or: [{ expireAt: { $exists: false } }, { expireAt: null }, { expireAt: { $gte: now } }] }
      ]
    }).sort({ order: 1 });
  }

  async getSlideById(id: string): Promise<ICarouselConfig | null> {
    return CarouselConfig.findById(id);
  }

  async createSlide(data: CreateCarouselSlideDTO): Promise<ICarouselConfig> {
    // Si no se especifica el orden, poner al final
    if (data.order === undefined) {
      const lastSlide = await CarouselConfig.findOne().sort({ order: -1 });
      data.order = lastSlide ? lastSlide.order + 1 : 0;
    }
    const newSlide = new CarouselConfig(data);
    return newSlide.save();
  }

  async updateSlide(id: string, data: UpdateCarouselSlideDTO): Promise<ICarouselConfig | null> {
    return CarouselConfig.findByIdAndUpdate(id, { $set: data }, { new: true });
  }

  async deleteSlide(id: string): Promise<ICarouselConfig | null> {
    return CarouselConfig.findByIdAndDelete(id);
  }

  async reorderSlides(items: ReorderSlidesDTO[]): Promise<void> {
    const updatePromises = items.map(item =>
      CarouselConfig.findByIdAndUpdate(item.slideId, { order: item.order })
    );
    await Promise.all(updatePromises);
  }
}

export default new CarouselService();
