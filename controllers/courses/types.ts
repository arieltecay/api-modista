import { ICourse } from "../../models/Course.js";

export interface Testimonial {
  id: string;
  name: string;
  description: string;
}

// Interface para curso con id agregado
export interface CourseWithId extends ICourse {
  id: string;
}

// Interfaces para las nuevas funciones CRUD
export interface CreateCourseBody {
  title: string;
  shortDescription: string;
  longDescription: string;
  imageUrl: string;
  category: string;
  price: number;
  deeplink?: string;
  videoUrl?: string;
  coursePaid?: string;
}

export interface UpdateCourseBody extends Partial<CreateCourseBody> { }

export interface GetCoursesQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: keyof ICourse;
  sortOrder?: 'asc' | 'desc';
}