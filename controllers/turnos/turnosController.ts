import { Request, Response } from 'express';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js'; // Importar modelo Course
import { logError } from '../../services/logger.js';

// Helper para obtener el _id de un curso a partir de un UUID o _id
const getCourseObjectId = async (id: string): Promise<string> => {
    // Si parece un UUID (tiene guiones), buscar el curso
    if (id && id.includes('-')) {
        const course = await Course.findOne({ uuid: id }).select('_id');
        return course ? (course._id as any).toString() : id;
    }
    return id; // Si no tiene guiones, asumir que es un _id
};

// @desc    Obtener turnos por curso
// @route   GET /api/turnos/course/:courseId
// @access  Public
export const getTurnosByCourse = async (req: Request, res: Response) => {
    try {
        let { courseId } = req.params;
        const { admin } = req.query;

        // Resolver UUID a ObjectId si es necesario
        courseId = await getCourseObjectId(courseId);

        const query: any = {
            courseId,
            isActive: true
        };

        // Si no es admin, solo mostrar habilitados
        if (admin !== 'true') {
            query.isBlocked = false;
        }

        const turnos = await Turno.find(query).sort({ diaSemana: 1, horaInicio: 1 });

        res.status(200).json({
            success: true,
            data: turnos
        });
    } catch (error) {
        logError('getTurnosByCourse', error instanceof Error ? error : new Error(String(error)));
        res.status(500).json({ success: false, message: 'Error al obtener los turnos.' });
    }
};

// @desc    Crear un nuevo turno
// @route   POST /api/turnos
// @access  Private (Admin)
export const createTurno = async (req: Request, res: Response) => {
    try {
        // Resolver UUID a ObjectId si es necesario en el body
        if (req.body.courseId) {
            req.body.courseId = await getCourseObjectId(req.body.courseId);
        }

        const turno = await Turno.create(req.body);
        res.status(201).json({
            success: true,
            data: turno
        });
    } catch (error) {
        logError('createTurno', error instanceof Error ? error : new Error(String(error)));
        res.status(500).json({ success: false, message: 'Error al crear el turno.' });
    }
};

// @desc    Actualizar un turno
// @route   PATCH /api/turnos/:id
// @access  Private (Admin)
export const updateTurno = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Resolver UUID a ObjectId si es necesario en el body
        if (req.body.courseId) {
            req.body.courseId = await getCourseObjectId(req.body.courseId);
        }

        const turno = await Turno.findByIdAndUpdate(id, req.body, { new: true });

        if (!turno) {
            return res.status(404).json({ success: false, message: 'Turno no encontrado.' });
        }

        res.status(200).json({
            success: true,
            data: turno
        });
    } catch (error) {
        logError('updateTurno', error instanceof Error ? error : new Error(String(error)));
        res.status(500).json({ success: false, message: 'Error al actualizar el turno.' });
    }
};

// @desc    Eliminar un turno (O desactivar)
// @route   DELETE /api/turnos/:id
// @access  Private (Admin)
export const deleteTurno = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const turno = await Turno.findByIdAndDelete(id);

        if (!turno) {
            return res.status(404).json({ success: false, message: 'Turno no encontrado.' });
        }

        res.status(200).json({
            success: true,
            message: 'Turno eliminado correctamente.'
        });
    } catch (error) {
        logError('deleteTurno', error instanceof Error ? error : new Error(String(error)));
        res.status(500).json({ success: false, message: 'Error al eliminar el turno.' });
    }
};
