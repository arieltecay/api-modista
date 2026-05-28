export interface CreateLandingPageBody {
  title: string;
  slug: string;
  courseId: string;
  status?: 'active' | 'inactive';
  customTitle?: string;
  customDescription?: string;
  buttonText?: string;
  videoUrl?: string;
}

export interface UpdateLandingPageBody extends Partial<CreateLandingPageBody> { }

export interface GetLandingPagesQuery {
  page?: string;
  limit?: string;
  search?: string;
}
