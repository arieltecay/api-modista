import { logError } from '../../services/logger.js';
import Course from '../../models/Course.ts';
import { testimonials } from './courses_data.js';

export const getTestimonials = async (req, res) => {
    try {
        res.status(200).json(testimonials);
    } catch (error) {
        logError("getTestimonials", error);
        res.status(500).json({ message: "Error al obtener los testimonios" });
    }
};

export const getCourses = async (req, res) => {
    try {
        const courses = await Course.find();
        // Agregar un campo 'id' que sea la posición (1-indexed) para compatibilidad
        const coursesWithId = courses.map((course, index) => ({
            ...course.toObject(),
            id: (index + 1).toString() // Convertir a string para consistencia
        }));
        res.status(200).json(coursesWithId);
    } catch (error) {
        logError("getCourses", error);
        res.status(500).json({ message: "Error al obtener los cursos" });
    }
};

export const getCourseById = async (req, res) => {
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
                return res.status(404).json({ message: "Curso no encontrado" });
            }
            res.status(200).json({
                ...course.toObject(),
                id: id
            });
        }
    } catch (error) {
        logError("getCourseById", error);
        res.status(500).json({ message: "Error al obtener el curso" });
    }
};
