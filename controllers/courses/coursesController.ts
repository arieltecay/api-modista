import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import Course from '../../models/Course.js';
import cloudinary from '../../config/cloudinaryConfig.js';
import { generateUniqueUUID, resolveCourseIdentifier } from './helper.js';
import { CreateCourseBody, GetCoursesQuery, UpdateCourseBody } from './types.js';
import { cache } from '../../utils/cache.js';

export const getCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit, page = '1' } = req.query;
    const cacheKey = `courses_list_${limit || 'all'}_${page}`;
    
    // Intentar obtener del caché
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.status(200).json(cachedData);
      return;
    }

    // Obtener todos los cursos sin filtros de entorno local
    const query = {};

    let courses;
    if (limit) {
      const limitNum = parseInt(limit as string, 10);
      const pageNum = parseInt(page as string, 10);
      const skip = (pageNum - 1) * limitNum;
      
      courses = await Course.find(query)
        .sort({ createdAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limitNum);
    } else {
      // Si no hay límite, establecer uno máximo razonable para proteger el servidor (ej. 100)
      courses = await Course.find(query)
        .sort({ createdAt: -1, updatedAt: -1 })
        .limit(100);
    }

    // Usar UUID como id principal, mantener compatibilidad backward
    const coursesWithId: any[] = courses.map((course, index) => ({
      ...course.toObject(),
      id: course.uuid, // UUID único como id principal
      courseId: (course._id as any).toString(), // _id de MongoDB como respaldo
      // Mantener posición como campo adicional para compatibilidad
      position: (index + 1).toString()
    }));

    // Guardar en caché por 5 minutos (300 segundos)
    cache.set(cacheKey, coursesWithId, 300);

    res.status(200).json(coursesWithId);
  } catch (error) {
    logError("getCourses", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: "Error al obtener los cursos" });
  }
};

export const getCourseById = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cacheKey = `course_detail_${id}`;

    // Intentar obtener del caché
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      res.status(200).json(cachedData);
      return;
    }

    // Usar el helper centralizado para resolver el curso
    // Soporta UUID, ObjectId y Posición Legacy con las prioridades correctas
    const course = await resolveCourseIdentifier(id);

    if (!course) {
      res.status(404).json({ message: "Curso no encontrado" });
      return;
    }

    const courseData = {
      ...course.toObject(),
      id: course.uuid, // UUID como id principal
      courseId: (course._id as any).toString(), // _id como respaldo
    };

    // Guardar en caché por 5 minutos
    cache.set(cacheKey, courseData, 300);

    res.status(200).json(courseData);
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

    // Invalidar caché de cursos
    cache.clear();

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

    // Resolver UUID a ObjectId si es necesario
    let course;
    const filter = (id && id.includes('-')) ? { uuid: id } : { _id: id };
    
    // Buscar curso actual para manejar cambio de imagen
    const existingCourse = await Course.findOne(filter);
    if (!existingCourse) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    // Si la imagen cambia, borrar la anterior de Cloudinary
    if (filteredUpdateData.imagePublicId && existingCourse.imagePublicId && filteredUpdateData.imagePublicId !== existingCourse.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(existingCourse.imagePublicId);
      } catch (cloudinaryError) {
        logError("updateCourse:cloudinary", cloudinaryError instanceof Error ? cloudinaryError : new Error(String(cloudinaryError)));
      }
    }

    course = await Course.findOneAndUpdate(filter, filteredUpdateData, { new: true, runValidators: true });

    if (!course) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    // Invalidar caché
    cache.clear();

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

    let course;
    if (id && id.includes('-')) {
      course = await Course.findOneAndDelete({ uuid: id });
    } else {
      course = await Course.findByIdAndDelete(id);
    }

    if (!course) {
      res.status(404).json({ success: false, message: 'Curso no encontrado' });
      return;
    }

    // Borrar imagen de Cloudinary si existe el publicId
    if (course.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(course.imagePublicId);
      } catch (cloudinaryError) {
        logError("deleteCourse:cloudinary", cloudinaryError instanceof Error ? cloudinaryError : new Error(String(cloudinaryError)));
        // No detenemos el proceso si falla el borrado en Cloudinary
      }
    }

    // Invalidar caché
    cache.clear();

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

    // Mapear UUID como id para consistencia con el frontend público
    const coursesWithId = result.docs.map((course: any) => ({
      ...course.toObject(),
      id: course.uuid,
      courseId: course._id.toString()
    }));

    res.status(200).json({
      data: coursesWithId,
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

    const query = { title: decodedCourseTitle };

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
