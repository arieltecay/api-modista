export interface CreateCarouselSlideDTO {
  title: string;
  subtitle?: string;
  imageUrl: string;
  imagePublicId: string;
  link: string;
  buttonText?: string;
  order?: number;
  isActive?: boolean;
  publishAt?: Date;
  expireAt?: Date;
}

export interface UpdateCarouselSlideDTO extends Partial<CreateCarouselSlideDTO> { }

export interface ReorderSlidesDTO {
  slideId: string;
  order: number;
}[]
