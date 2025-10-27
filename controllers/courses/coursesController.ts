import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import Course, { ICourse } from '../../models/Course.js';
import { testimonials } from './courses_data.js';
import { randomUUID } from 'crypto';

// Interface para testimonial
interface Testimonial {
  id: string;
  name: string;
  description: string;
}

// Interface para curso con id agregado
interface CourseWithId extends ICourse {
  id: string;
}

// Interfaces para las nuevas funciones CRUD
interface CreateCourseBody {
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

interface UpdateCourseBody extends Partial<CreateCourseBody> { }

interface GetCoursesQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: keyof ICourse;
  sortOrder?: 'asc' | 'desc';
}

// Función helper para generar UUID único verificando unicidad en BD
const generateUniqueUUID = async (): Promise<string> => {
  let uuid: string;
  let attempts = 0;
  const maxAttempts = 10; // Límite de intentos para evitar bucles infinitos

  do {
    uuid = randomUUID();
    attempts++;

    // Verificar si el UUID ya existe en la BD
    const existingCourse = await Course.findOne({ uuid });

    if (!existingCourse) {
      return uuid; // UUID único encontrado
    }
  } while (attempts < maxAttempts);

  // Si después de varios intentos no encontramos un UUID único, lanzamos error
  throw new Error('No se pudo generar un UUID único después de varios intentos');
};

export const getTestimonials = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(testimonials);
  } catch (error) {
    logError("getTestimonials", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los testimonios" });
  }
};

export const getCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    // Determinar si estamos en desarrollo
    // const isDevelopment = process.env.NODE_ENV === 'development';
    const isDevelopment = process.env.URL_LOCAL === 'http://localhost:5173';

    // Construir query: excluir cursos de test en producción
    const query = isDevelopment ? {} : { category: { $ne: 'test' } };

    // Ordenar por fecha de creación descendente, luego por fecha de actualización descendente
    const courses = await Course.find(query).sort({ createdAt: -1, updatedAt: -1 });
    // Usar UUID como id principal, mantener compatibilidad backward
    const coursesWithId: any[] = courses.map((course, index) => ({
      ...course.toObject(),
      id: course.uuid, // UUID único como id principal
      courseId: (course._id as any).toString(), // _id de MongoDB como respaldo
      // Mantener posición como campo adicional para compatibilidad
      position: (index + 1).toString()
    }));
    res.status(200).json(coursesWithId);
  } catch (error) {
    logError("getCourses", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los cursos" });
  }
};

export const getCourseById = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // Determinar si estamos en desarrollo
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Construir query: excluir cursos de test en producción
    const query = isDevelopment ? {} : { category: { $ne: 'test' } };

    // Buscar por UUID primero (nuevo sistema)
    let course = await Course.findOne({ uuid: id, ...query });

    if (!course) {
      // Compatibilidad backward: buscar por _id de MongoDB
      course = await Course.findById(id);
      if (course && !isDevelopment && course.category === 'test') {
        course = null; // Excluir cursos de test en producción
      }
    }

    if (!course) {
      // Última compatibilidad: buscar por posición numérica (legacy)
      const numericId = parseInt(id);
      if (!isNaN(numericId) && numericId > 0) {
        const courses = await Course.find(query).sort({ createdAt: -1, updatedAt: -1 });
        if (numericId <= courses.length) {
          course = courses[numericId - 1]; // Array es 0-indexed
        }
      }
    }

    if (!course) {
      res.status(404).json({ message: "Curso no encontrado" });
      return;
    }

    res.status(200).json({
      ...course.toObject(),
      id: course.uuid, // UUID como id principal
      courseId: (course._id as any).toString(), // _id como respaldo
    });
  } catch (error) {
    logError("getCourseById", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener el curso" });
  }
};

// @desc    Crear un nuevo curso
// @route   POST /api/courses
// @access  Private (Protected by JWT + Admin role)
export const createCourse = async (req: Request<{}, {}, CreateCourseBody>, res: Response): Promise<void> => {
  try {
    const { title, shortDescription, longDescription, imageUrl, category, price } = req.body;

    // Validación básica
    if (!title || !shortDescription || !longDescription || !imageUrl || !category || price == null) {
      res.status(400).json({ success: false, message: 'Todos los campos requeridos deben ser proporcionados' });
      return;
    }

    // Validación de precio
    if (price < 0) {
      res.status(400).json({ success: false, message: 'El precio no puede ser negativo' });
      return;
    }

    // Generar UUID único verificando unicidad en BD
    const uniqueUUID = await generateUniqueUUID();

    // Crear el curso con el UUID generado
    const courseData = {
      ...req.body,
      uuid: uniqueUUID
    };

    const course = await Course.create(courseData);
    res.status(201).json({
      success: true,
      data: {
        ...course.toObject(),
        id: course.uuid, // UUID como id principal
        courseId: (course._id as any).toString(), // _id como respaldo
      },
      message: 'Curso creado exitosamente'
    });
  } catch (error) {
    logError("createCourse", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al crear el curso' });
  }
};

// @desc    Actualizar un curso existente
// @route   PUT /api/courses/:id
// @access  Private (Protected by JWT + Admin role)
export const updateCourse = async (req: Request<{ id: string }, {}, UpdateCourseBody>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validación de precio si se proporciona
    if (updateData.price !== undefined && updateData.price < 0) {
      res.status(400).json({ success: false, message: 'El precio no puede ser negativo' });
      return;
    }

    // Filtrar campos opcionales que vienen como undefined para eliminarlos de la BD
    const filteredUpdateData: any = { ...updateData };
    ['deeplink', 'videoUrl', 'coursePaid'].forEach(field => {
      if (filteredUpdateData[field] === undefined) {
        filteredUpdateData[field] = null; // Usar null para que MongoDB elimine el campo
      }
    });

    const course = await Course.findByIdAndUpdate(
      id,
      filteredUpdateData,
      { new: true, runValidators: true }
    );

    if (!course) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    res.status(200).json({
      success: true,
      data: course,
      message: 'Curso actualizado exitosamente'
    });
  } catch (error) {
    logError("updateCourse", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al actualizar el curso' });
  }
};

// @desc    Eliminar un curso
// @route   DELETE /api/courses/:id
// @access  Private (Protected by JWT + Admin role)
export const deleteCourse = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const course = await Course.findByIdAndDelete(id);

    if (!course) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Curso eliminado exitosamente'
    });
  } catch (error) {
    logError("deleteCourse", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al eliminar el curso' });
  }
};

// @desc    Obtener todos los cursos con paginación para admin
// @route   GET /api/courses/admin
// @access  Private (Protected by JWT + Admin role)
export const getCoursesAdmin = async (req: Request<{}, {}, {}, GetCoursesQuery>, res: Response): Promise<void> => {
  const { page = '1', limit = '10', search, sortBy, sortOrder } = req.query;

  try {
    let queryFilter = {};
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      queryFilter = {
        $or: [
          { title: searchRegex },
          { category: searchRegex },
          { shortDescription: searchRegex }
        ]
      };
    }

    const sortOptions: { [key: string]: 1 | -1 } = {};
    if (sortBy) {
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortOptions.createdAt = -1; // Ordenar por fecha de creación por defecto
    }

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sortOptions
    };

    const result = await (Course as any).paginate(queryFilter, options);

    res.status(200).json({
      data: result.docs,
      total: result.totalDocs,
      totalPages: result.totalPages,
      currentPage: result.page,
    });
  } catch (error) {
    logError('getCoursesAdmin', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al obtener los cursos.' });
  }
};

// @desc    Obtener el link del curso pagado por título del curso
// @route   GET /api/courses/course-paid/:courseTitle
// @access  Private (Protected by JWT + Admin role)
export const getCoursePaidLink = async (req: Request<{ courseTitle: string }>, res: Response): Promise<void> => {
  try {
    const { courseTitle } = req.params;

    // Buscar el curso por título (decodificar URL si es necesario)
    const decodedCourseTitle = decodeURIComponent(courseTitle);

    // Determinar si estamos en desarrollo para saber cómo buscar
    const isDevelopment = process.env.URL_LOCAL === 'http://localhost:5173';
    const query = isDevelopment ? { title: decodedCourseTitle } : { title: decodedCourseTitle, category: { $ne: 'test' } };

    const course = await Course.findOne(query);

    if (!course) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    // Verificar que tenga coursePaid configurado
    if (!course.coursePaid) {
      res.status(404).json({ success: false, message: 'Este curso no tiene un link de acceso configurado' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        courseId: (course._id as any).toString(),
        courseTitle: course.title,
        coursePaid: course.coursePaid
      }
    });
  } catch (error) {
    logError('getCoursePaidLink', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al obtener el link del curso' });
  }
};
