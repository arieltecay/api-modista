import { Request, Response, NextFunction } from 'express';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import Course from '../../models/Course.js';
import { logError } from '../../services/logger.js';
import { sendDepositEmail } from '../../services/emailServices.js';
import ExcelJS from 'exceljs';
import { CreateInscriptionBody, ExportInscriptionsQuery, GetInscriptionsQuery, UpdateDepositBody, UpdatePaymentStatusBody } from './types.js';

// --- Controlador ---

// @desc    Crear una nueva inscripción
// @route   POST /api/inscriptions
// @access  Public
export const createInscription = async (req: Request<{}, {}, CreateInscriptionBody>, res: Response) => {
  try {
    const { nombre, apellido, email, celular, courseId, courseTitle, coursePrice, turnoId } = req.body;

    // Validación básica
    if (!nombre || !apellido || !email || !celular || !courseId || !courseTitle || coursePrice == null) {
      return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }

    // Validación de Turno (si se proporciona)
    let turnoData = null;
    if (turnoId) {
      turnoData = await Turno.findById(turnoId);
      if (!turnoData) {
        return res.status(404).json({ success: false, message: 'El turno seleccionado no existe' });
      }
      if (turnoData.isBlocked || !turnoData.isActive) {
        return res.status(400).json({ success: false, message: 'El turno seleccionado no está disponible' });
      }
      if (turnoData.cuposInscriptos >= turnoData.cupoMaximo) {
        return res.status(400).json({ success: false, message: 'El turno seleccionado ya no tiene cupos disponibles' });
      }
    }

    // Validación: verificar si ya existe una inscripción para este email + courseId específico
    const existingInscription = await Inscription.findOne({
      email: email,
      courseId: courseId
    });

    if (existingInscription) {
      return res.status(409).json({
        success: false,
        message: 'Ya te encuentras inscripto en este curso con este email.'
      });
    }

    const inscription = await Inscription.create(req.body);
    res.status(201).json({
      success: true,
      data: inscription,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      const errorMessage = ('message' in error && typeof error.message === 'string') ? error.message : '';
      if (errorMessage.includes('email') && errorMessage.includes('courseId')) {
        return res.status(409).json({
          success: false,
          message: 'Ya te encuentras inscripto en este curso con este email.'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Ya existe una inscripción con estos datos.'
      });
    }

    const errorMessage = error instanceof Error ? error.message : 'Error desconocido del servidor';
    res.status(500).json({ success: false, message: 'Error del servidor', error: errorMessage });
  }
};

// @desc    Obtener todas las inscripciones con paginación
// @route   GET /api/inscriptions
// @access  Private (Protected by JWT + Admin role)
export const getInscriptions = async (req: Request<{}, {}, {}, GetInscriptionsQuery>, res: Response) => {
  const { page = '1', limit = '10', search, sortBy, sortOrder, paymentStatusFilter = 'all', courseFilter, excludeWorkshops = 'false' } = req.query;
  // Validar filtro de paymentStatus
  const validFilters = ['all', 'paid', 'pending'];
  if (!validFilters.includes(paymentStatusFilter)) {
    return res.status(400).json({ message: 'Filtro de estado de pago inválido. Use: all, paid, o pending.' });
  }

  try {
    let queryFilter: any = {};
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      queryFilter = {
        $or: [
          { nombre: searchRegex },
          { apellido: searchRegex },
          { email: searchRegex }
        ]
      };
    }

    // Agregar filtro por paymentStatus
    if (paymentStatusFilter !== 'all') {
      queryFilter.paymentStatus = paymentStatusFilter;
    }

    // Agregar filtro por curso (soporta título con regex o UUID exacto)
    if (courseFilter) {
      // Si el filtro parece un UUID (contiene guiones), filtrar por courseId exacto
      if (courseFilter.includes('-')) {
        queryFilter.courseId = courseFilter;
      } else {
        // De lo contrario, filtrar por título con regex
        queryFilter.courseTitle = { $regex: courseFilter, $options: 'i' };
      }
    }

    // CONDICIONAL: Solo excluir talleres si se solicita explícitamente
    if (excludeWorkshops === 'true') {
      const workshopCourses = await Course.find({ isPresencial: true }).select('uuid');
      const workshopCourseIds = workshopCourses.map(c => c.uuid).filter(Boolean);

      if (workshopCourseIds.length > 0) {
        queryFilter.courseId = { $nin: workshopCourseIds };
      }
    }

    const sortOptions: { [key: string]: 1 | -1 } = {};
    if (sortBy) {
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortOptions.fechaInscripcion = -1;
    }

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: sortOptions
    };

    // Asumimos que el modelo Inscription tiene el método paginate de mongoose-paginate-v2
    const result = await (Inscription as any).paginate(queryFilter, {
      ...options,
      populate: 'turnoId'
    });

    res.status(200).json({
      data: result.docs,
      total: result.totalDocs,
      totalPages: result.totalPages,
      currentPage: result.page,
    });
  } catch (error) {
    logError('getInscriptions', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al obtener las inscripciones.' });
  }
};


// @desc    Exportar inscripciones a XLS
// @route   GET /api/inscriptions/export
// @access  Private (JWT + Admin role)
export const exportInscriptions = async (req: Request<{}, {}, {}, ExportInscriptionsQuery>, res: Response) => {
  const { paymentStatusFilter = 'all', search, courseFilter, excludeWorkshops = 'false' } = req.query;

  // Validar filtro de paymentStatus
  const validFilters = ['all', 'paid', 'pending'];
  if (!validFilters.includes(paymentStatusFilter)) {
    return res.status(400).json({ message: 'Filtro de estado de pago inválido. Use: all, paid, o pending.' });
  }

  try {
    let queryFilter: any = {};

    // Aplicar filtro de búsqueda igual que en getInscriptions
    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      queryFilter = {
        $or: [
          { nombre: searchRegex },
          { apellido: searchRegex },
          { email: searchRegex }
        ]
      };
    }

    // Aplicar filtro por curso (soporta título con regex o UUID exacto)
    if (courseFilter) {
      // Si el filtro parece un UUID (contiene guiones), filtrar por courseId exacto
      if (courseFilter.includes('-')) {
        queryFilter.courseId = courseFilter;
      } else {
        // De lo contrario, filtrar por título con regex
        queryFilter.courseTitle = { $regex: courseFilter, $options: 'i' };
      }
    }

    // Aplicar filtro por paymentStatus igual que en getInscriptions
    if (paymentStatusFilter !== 'all') {
      queryFilter.paymentStatus = paymentStatusFilter;
    }

    // CONDICIONAL: Solo excluir talleres si se solicita explícitamente
    if (excludeWorkshops === 'true') {
      const workshopCourses = await Course.find({ isPresencial: true }).select('uuid');
      const workshopCourseIds = workshopCourses.map(c => c.uuid).filter(Boolean);

      if (workshopCourseIds.length > 0) {
        queryFilter.courseId = { $nin: workshopCourseIds };
      }
    }

    const inscriptions = await Inscription.find(queryFilter).sort({ fechaInscripcion: -1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inscripciones');

    // Definir las columnas y cabeceras
    worksheet.columns = [
      { header: 'Nombre', key: 'nombre', width: 20 },
      { header: 'Apellido', key: 'apellido', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Celular', key: 'celular', width: 15 },
      { header: 'Curso', key: 'courseTitle', width: 30 },
      { header: 'Precio', key: 'coursePrice', width: 10 },
      { header: 'Estado de Pago', key: 'paymentStatus', width: 15 },
      { header: 'Fecha de Inscripción', key: 'fechaInscripcion', width: 20 },
    ];

    // Estilizar la fila de cabeceras
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF203040' },
    };

    // Añadir los datos
    inscriptions.forEach(inscription => {
      worksheet.addRow({
        ...inscription.toObject(),
        paymentStatus: inscription.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente',
        fechaInscripcion: inscription.fechaInscripcion.toLocaleDateString('es-AR'),
      });
    });

    // Configurar la respuesta para la descarga del archivo
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inscripciones.xlsx"');

    // Escribir el buffer en la respuesta
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido al exportar';
    res.status(500).json({ success: false, message: 'Error al exportar los datos', error: errorMessage });
  }
};

// @desc    Actualizar estado de pago de una inscripción
// @route   PATCH /api/inscriptions/:id/payment-status
// @access  Private (JWT + Admin role)
export const updatePaymentStatus = async (req: Request<{ id: string }, {}, UpdatePaymentStatusBody>, res: Response) => {
  const { id } = req.params;
  const { paymentStatus } = req.body;

  if (!['pending', 'paid'].includes(paymentStatus)) {
    return res.status(400).json({ message: 'Estado de pago inválido.' });
  }

  try {
    const inscription = await Inscription.findById(id);

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada.' });
    }

    // Solo actuar si hay un cambio de estado
    if (inscription.paymentStatus !== paymentStatus) {
      if (paymentStatus === 'paid') {
        // Manejo de Cupos al pagar
        if (inscription.turnoId && !inscription.isReserved) {
          const turno = await Turno.findById(inscription.turnoId);
          if (turno) {
            if (turno.cuposInscriptos >= turno.cupoMaximo) {
              return res.status(400).json({
                success: false,
                message: 'No se puede marcar como pagado: El turno ya ha alcanzado su cupo máximo.'
              });
            }
            // Incrementar cupo
            await Turno.findByIdAndUpdate(inscription.turnoId, { $inc: { cuposInscriptos: 1 } });
            inscription.isReserved = true;
          }
        }
      } else if (paymentStatus === 'pending' && inscription.paymentStatus === 'paid') {
        // Liberar cupo si vuelve a pendiente
        if (inscription.turnoId && inscription.isReserved) {
          await Turno.findByIdAndUpdate(inscription.turnoId, { $inc: { cuposInscriptos: -1 } });
          inscription.isReserved = false;
        }
      }
    }

    inscription.paymentStatus = paymentStatus;
    inscription.paymentDate = paymentStatus === 'paid' ? new Date() : undefined;
    await inscription.save();

    res.status(200).json({
      success: true,
      data: inscription,
      message: `Estado actualizado a ${paymentStatus}`
    });
  } catch (error) {
    logError('updatePaymentStatus', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al actualizar estado de pago.' });
  }
};

// @desc    Actualizar seña de una inscripción
// @route   PATCH /api/inscriptions/:id/deposit
// @access  Private (JWT + Admin role)
export const updateDeposit = async (req: Request<{ id: string }, {}, UpdateDepositBody>, res: Response) => {
  const { id } = req.params;
  const { depositAmount } = req.body;

  if (depositAmount <= 0) {
    return res.status(400).json({ success: false, message: 'La seña debe ser mayor a cero.' });
  }

  try {
    const inscription = await Inscription.findById(id).populate('turnoId');

    if (!inscription) {
      return res.status(404).json({ success: false, message: 'Inscripción no encontrada.' });
    }

    if (depositAmount >= inscription.coursePrice) {
      return res.status(400).json({ success: false, message: 'La seña no puede ser igual o mayor al total del curso.' });
    }

    // Si no está reservado, descontar un cupo
    if (!inscription.isReserved && inscription.turnoId) {
      const turno = await Turno.findById(inscription.turnoId);
      if (turno) {
        if (turno.cuposInscriptos >= turno.cupoMaximo) {
          return res.status(400).json({
            success: false,
            message: 'No se puede registrar la seña: El turno ya ha alcanzado su cupo máximo.'
          });
        }
        await Turno.findByIdAndUpdate(inscription.turnoId, { $inc: { cuposInscriptos: 1 } });
        inscription.isReserved = true;
      }
    }

    inscription.depositAmount = depositAmount;
    inscription.depositDate = new Date();
    await inscription.save();

    // Enviar correo de confirmación de seña
    try {
      await sendDepositEmail(inscription);
    } catch (err) {
      logError('sendDepositEmail', err instanceof Error ? err : new Error(String(err)));
      // No devolvemos error 500 para que la seña quede registrada aunque falle el mail
    }

    res.status(200).json({
      success: true,
      data: inscription,
      message: 'Seña registrada correctamente.'
    });
  } catch (error) {
    logError('updateDeposit', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, message: 'Error al actualizar la seña.' });
  }
};

// @desc    Contar todas las inscripciones
// @route   GET /api/inscriptions/count
// @access  Public
export const countInscriptions = async (req: Request, res: Response) => {
  try {
    const { excludeWorkshops = 'false' } = req.query as { excludeWorkshops?: string };

    let excludeFilter: any = {};

    // CONDICIONAL: Solo excluir talleres si se solicita explícitamente
    if (excludeWorkshops === 'true') {
      const workshopCourses = await Course.find({ isPresencial: true }).select('uuid');
      const workshopCourseIds = workshopCourses.map(c => c.uuid).filter(Boolean);

      if (workshopCourseIds.length > 0) {
        excludeFilter.courseId = { $nin: workshopCourseIds };
      }
    }

    const total = await Inscription.countDocuments(excludeFilter);
    const paid = await Inscription.countDocuments({ ...excludeFilter, paymentStatus: 'paid' });
    const pending = await Inscription.countDocuments({ ...excludeFilter, paymentStatus: 'pending' });

    res.status(200).json({
      success: true,
      data: { total, paid, pending },
    });
  } catch (error) {
    logError('countInscriptions', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al contar las inscripciones.' });
  }
};
