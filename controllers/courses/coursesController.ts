import { Request, Response } from 'express';
import { logError } from '../../services/logger.js';
import Course, { ICourse } from '../../models/Course.js';
import { testimonials } from './courses_data.js';
import test from 'node:test';

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
        const courses = await Course.find();
        // Agregar un campo 'id' que sea la posición (1-indexed) para compatibilidad
        const coursesWithId: any[] = courses.map((course, index) => ({
            ...course.toObject(),
            id: (index + 1).toString() // Convertir a string para consistencia
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
        const courses = await Course.find();

        // Si el ID es numérico, buscar por posición (1-indexed)
        const numericId = parseInt(id);
        if (!isNaN(numericId) && numericId > 0 && numericId <= courses.length) {
            const course = courses[numericId - 1]; // Array es 0-indexed
            res.status(200).json({
                ...course.toObject(),
                id: numericId.toString()
            });
        } else {
            // Si no es numérico o está fuera de rango, buscar por _id de MongoDB
            const course = await Course.findById(id);
            if (!course) {
                res.status(404).json({ message: "Curso no encontrado" });
                return;
            }
            res.status(200).json({
                ...course.toObject(),
                id: id
            });
        }
    } catch (error) {
        logError("getCourseById", error instanceof Error ? error : new Error(String(error)));
        res.status(500).json({ message: "Error al obtener el curso" });
    }
};
