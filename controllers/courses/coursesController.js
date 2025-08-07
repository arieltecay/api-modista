import { logError } from '../../services/logger.js';
import Course from '../../models/Course.js';
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
        res.status(200).json(courses);
    } catch (error) {
        logError("getCourses", error);
        res.status(500).json({ message: "Error al obtener los cursos" });
    }
};
