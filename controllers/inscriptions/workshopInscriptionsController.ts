import { Request, Response as ExpressResponse } from 'express';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js';
import { logError } from '../../services/logger.js';
import { GetInscriptionsQuery, ExportInscriptionsQuery } from './types.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

/**
 * @desc    Obtener inscripciones exclusivas de un taller presencial
 * @route   GET /api/workshop-inscriptions/:workshopId
 * @access  Private (Admin)
 */
export const getWorkshopInscriptions = async (req: Request<{ workshopId: string }, {}, {}, GetInscriptionsQuery>, res: ExpressResponse) => {
  const { workshopId } = req.params;
  const { page = '1', limit = '10', search, sortBy, sortOrder, paymentStatusFilter = 'all', turnoFilter } = req.query;

  try {
    let queryFilter: any = { courseId: workshopId };

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      queryFilter.$or = [
        { nombre: searchRegex },
        { apellido: searchRegex },
        { email: searchRegex }
      ];
    }

    if (paymentStatusFilter !== 'all') {
      queryFilter.paymentStatus = paymentStatusFilter;
    }

    if (turnoFilter && turnoFilter !== 'all' && mongoose.Types.ObjectId.isValid(turnoFilter)) {
      queryFilter.turnoId = turnoFilter;
    }

    const sortOptions: { [key: string]: 1 | -1 } = {};
    if (sortBy) {
      // Mapeo de campos de frontend a backend si es necesario
      const sortKey = sortBy === 'horario' ? 'turnoId' : sortBy;
      sortOptions[sortKey] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortOptions.fechaInscripcion = -1;
    }

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sortOptions,
      populate: 'turnoId'
    };

    const result = await (Inscription as any).paginate(queryFilter, options);

    res.status(200).json({
      data: result.docs,
      total: result.totalDocs,
      totalPages: result.totalPages,
      currentPage: result.page,
    });
  } catch (error) {
    logError('getWorkshopInscriptions', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al obtener las inscripciones del taller.' });
  }
};

/**
 * @desc    Exportar inscripciones de un taller a Excel
 * @route   GET /api/workshop-inscriptions/:workshopId/export
 * @access  Private (Admin)
 */
export const exportWorkshopInscriptions = async (req: Request<{ workshopId: string }, {}, {}, ExportInscriptionsQuery>, res: ExpressResponse) => {
  const { workshopId } = req.params;
  const { paymentStatusFilter = 'all', search, turnoFilter } = req.query;

  try {
    let queryFilter: any = { courseId: workshopId };

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      queryFilter.$or = [
        { nombre: searchRegex },
        { apellido: searchRegex },
        { email: searchRegex }
      ];
    }

    if (paymentStatusFilter !== 'all') {
      queryFilter.paymentStatus = paymentStatusFilter;
    }

    if (turnoFilter && turnoFilter !== 'all' && mongoose.Types.ObjectId.isValid(turnoFilter)) {
      queryFilter.turnoId = turnoFilter;
    }

    const inscriptions = await Inscription.find(queryFilter).populate('turnoId').sort({ fechaInscripcion: -1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inscripciones Taller');

    worksheet.columns = [
      { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Celular', key: 'celular', width: 15 },
      { header: 'Día', key: 'dia', width: 15 },
      { header: 'Horario', key: 'horario', width: 15 },
      { header: 'Precio', key: 'coursePrice', width: 10 },
      { header: 'Seña', key: 'depositAmount', width: 10 },
      { header: 'Estado', key: 'paymentStatus', width: 15 },
      { header: 'Fecha Insc.', key: 'fechaInscripcion', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };

    inscriptions.forEach(ins => {
      const turno: any = ins.turnoId;
      worksheet.addRow({
        ...ins.toObject(),
        dia: turno?.diaSemana || 'N/A',
        horario: turno?.horaInicio || 'N/A',
        paymentStatus: ins.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente',
        fechaInscripcion: ins.fechaInscripcion.toLocaleDateString('es-AR'),
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="taller_${workshopId}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    logError('exportWorkshopInscriptions', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al exportar los datos del taller.' });
  }
};

/**
 * @desc    Obtener datos detallados de un taller para la página de detalles
 * @route   GET /api/workshop-inscriptions/:workshopId/details
 * @access  Private (Admin)
 * @returns Datos limpios y organizados: resúmenes, inscriptos agrupados por turno
 */
export const getWorkshopDetails = async (req: Request<{ workshopId: string }>, res: ExpressResponse) => {
  const { workshopId } = req.params;

  try {
    const inscriptions = await Inscription.find({
      courseId: workshopId,
      isReserved: true,
      $or: [
        { paymentStatus: 'paid' },
        { depositAmount: { $gt: 0 } }
      ]
    }).populate('turnoId').sort({ fechaInscripcion: -1 });

    if (inscriptions.length === 0) {
      return res.status(200).json({
        workshopTitle: 'Sin inscripciones',
        workshopPrice: 0,
        summary: { totalPaidCount: 0, depositPaidCount: 0, totalInscriptions: 0 },
        turnoGroups: []
      });
    }

    const workshopTitle = inscriptions[0].courseTitle;
    const workshopPrice = inscriptions[0].coursePrice;

    const totalPaidCount = inscriptions.filter(
      (insc) => insc.paymentStatus === 'paid'
    ).length;

    const depositPaidCount = inscriptions.filter(
      (insc) => (insc.depositAmount ?? 0) > 0 && (insc.depositAmount ?? 0) < workshopPrice
    ).length;

    const turnoMap = new Map<string, {
      turnoId: string;
      turnoLabel: string;
      capacity: number;
      inscriptions: Array<{
        _id: string;
        nombre: string;
        apellido: string;
        depositAmount: number;
        isFullPayment: boolean;
      }>;
    }>();

    inscriptions.forEach((insc) => {
      const turno: any = insc.turnoId;
      const turnoId = turno?._id?.toString() || 'sin-turno';
      const turnoLabel = turno
        ? `${turno.diaSemana} ${turno.horaInicio} - ${turno.horaFin}`
        : 'Sin turno asignado';
      const capacity = turno?.cupoMaximo || 0;
      const depositAmount = insc.depositAmount ?? 0;

      if (!turnoMap.has(turnoId)) {
        turnoMap.set(turnoId, {
          turnoId,
          turnoLabel,
          capacity,
          inscriptions: []
        });
      }

      turnoMap.get(turnoId)!.inscriptions.push({
        _id: String(insc._id),
        nombre: insc.nombre,
        apellido: insc.apellido,
        depositAmount,
        isFullPayment: insc.paymentStatus === 'paid'
      });
    });

    const turnoGroups = Array.from(turnoMap.values()).map((group) => ({
      ...group,
      enrolled: group.inscriptions.length
    }));

    res.status(200).json({
      workshopTitle,
      workshopPrice,
      summary: {
        totalPaidCount,
        depositPaidCount,
        totalInscriptions: inscriptions.length
      },
      turnoGroups
    });
  } catch (error) {
    logError('getWorkshopDetails', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al obtener los detalles del taller.' });
  }
};


/**
 * @desc    Actualizar el turno de una inscripción
 * @route   PUT /api/workshop-inscriptions/:inscriptionId/schedule
 * @access  Private (Admin)
 */
export const updateInscriptionSchedule = async (req: Request<{ inscriptionId: string }, {}, { newTurnoId: string }>, res: ExpressResponse) => {
  const { inscriptionId } = req.params;
  const { newTurnoId } = req.body;

  // Basic validation
  if (!mongoose.Types.ObjectId.isValid(inscriptionId)) {
    return res.status(400).json({ message: 'ID de inscripción inválido.' });
  }
  if (!newTurnoId || !mongoose.Types.ObjectId.isValid(newTurnoId)) {
    return res.status(400).json({ message: 'ID de nuevo turno inválido.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find the inscription, populating the original turnoId
    const inscription = await Inscription.findById(inscriptionId).populate('turnoId').session(session);

    if (!inscription) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Inscripción no encontrada.' });
    }

    const originalTurno = inscription.turnoId as any;
    const courseId = inscription.courseId; // Assuming courseId is available on Inscription

    // Fetch the new Turno and validate its details
    const newTurno = await Turno.findById(newTurnoId).session(session);

    if (!newTurno) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Nuevo turno no encontrado.' });
    }

    let courseIdForValidation = inscription.courseId;

    // Resolve courseId if it's not a valid ObjectId (likely a UUID) to match Turno's courseId (ObjectId)
    if (courseIdForValidation && !mongoose.Types.ObjectId.isValid(courseIdForValidation)) {
      const course = await Course.findOne({ uuid: courseIdForValidation }).session(session);
      if (course) {
        courseIdForValidation = (course._id as any).toString();
      }
    }

    // Check if the new turno belongs to the same course
    if (newTurno.courseId.toString() !== courseIdForValidation.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'El nuevo turno no pertenece al mismo curso.' });
    }

    // Check if new turno is full
    if (newTurno.cuposInscriptos >= newTurno.cupoMaximo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'El nuevo turno seleccionado ya está lleno.' });
    }

    // Check if user is already enrolled in the new turno for the same course
    const existingEnrollmentInNewTurno = await Inscription.findOne({
      email: inscription.email, // Using email as user identifier
      turnoId: newTurnoId,
      courseId: courseId // Ensure it's for the same course
    }).session(session);

    if (existingEnrollmentInNewTurno) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'El usuario ya está inscrito en el nuevo turno seleccionado para este curso.' });
    }

    // If original turno exists and is different from new turno, decrement its enrollment count
    if (originalTurno && originalTurno._id && originalTurno._id.toString() !== newTurnoId.toString()) {
      await Turno.updateOne(
        { _id: originalTurno._id },
        { $inc: { cuposInscriptos: -1 } },
        { session }
      );
    }

    // Increment new turno's enrollment count
    await Turno.updateOne(
      { _id: newTurnoId },
      { $inc: { cuposInscriptos: 1 } },
      { session }
    );

    // Update inscription with new turnoId
    inscription.turnoId = new mongoose.Types.ObjectId(newTurnoId) as any;
    await inscription.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: 'Horario de inscripción actualizado exitosamente.', inscription });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logError('updateInscriptionSchedule', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al actualizar el horario de la inscripción.' });
  }
}


/**
 * @desc    Obtener turnos disponibles para reagendar una inscripción
 * @route   GET /api/workshop-inscriptions/inscription/:inscriptionId/available-turnos
 * @access  Private (Admin)
 */
export const getAvailableTurnosForReschedule = async (req: Request<{ inscriptionId: string }>, res: ExpressResponse) => {
  const { inscriptionId } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(inscriptionId)) {
      return res.status(400).json({ message: 'ID de inscripción inválido.' });
    }

    const inscription = await Inscription.findById(inscriptionId);
    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada.' });
    }

    const courseId = inscription.courseId;
    const currentTurnoId = inscription.turnoId ? inscription.turnoId.toString() : null;

    let targetCourseId = courseId;

    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      const course = await Course.findOne({ uuid: courseId });

      if (!course) {
        return res.status(400).json({ message: 'ID de curso inválido en la inscripción.' });
      }
      targetCourseId = (course as any)._id.toString();
    }

    // Fetch all active turnos for this course
    const turnos = await Turno.find({
      courseId: targetCourseId,
      isActive: true,
    }).sort({ diaSemana: 1, horaInicio: 1 });

    const availableTurnos = turnos.filter(turno => {
      const isCurrentTurno = currentTurnoId && (turno as any)._id.toString() === currentTurnoId;
      const hasSpace = turno.cuposInscriptos < turno.cupoMaximo;

      if (isCurrentTurno) return true;
      return hasSpace; // Filter only by hasSpace, ignore isBlocked for new options
    });

    res.status(200).json(availableTurnos);

  } catch (error) {
    logError('getAvailableTurnosForReschedule', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al obtener turnos disponibles.' });
  }
};