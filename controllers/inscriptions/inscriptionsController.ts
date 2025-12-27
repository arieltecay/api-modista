import { Request, Response, NextFunction } from 'express';
import Inscription from '../../models/Inscription.js';
import { logError } from '../../services/logger.js';
import ExcelJS from 'exceljs';
import { CreateInscriptionBody, ExportInscriptionsQuery, GetInscriptionsQuery, UpdatePaymentStatusBody } from './types.js';

// --- Controlador ---

// @desc    Crear una nueva inscripción
// @route   POST /api/inscriptions
// @access  Public
export const createInscription = async (req: Request<{}, {}, CreateInscriptionBody>, res: Response) => {
  try {
    const { nombre, apellido, email, celular, courseId, courseTitle, coursePrice } = req.body;

    // Validación básica (TypeScript ya ayuda a asegurar los tipos)
    if (!nombre || !apellido || !email || !celular || !courseId || !courseTitle || coursePrice == null) {
      return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
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
  const { page = '1', limit = '10', search, sortBy, sortOrder, paymentStatusFilter = 'all', courseFilter } = req.query;
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

    // Agregar filtro por curso
    if (courseFilter) {
      queryFilter.courseTitle = { $regex: courseFilter, $options: 'i' };
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
    const result = await (Inscription as any).paginate(queryFilter, options);

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
  const { paymentStatusFilter = 'all', search, courseFilter } = req.query;

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

    // Aplicar filtro por curso
    if (courseFilter) {
      queryFilter.courseTitle = { $regex: courseFilter, $options: 'i' };
    }

    // Aplicar filtro por paymentStatus igual que en getInscriptions
    if (paymentStatusFilter !== 'all') {
      queryFilter.paymentStatus = paymentStatusFilter;
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
    const inscription = await Inscription.findByIdAndUpdate(
      id,
      {
        paymentStatus,
        paymentDate: paymentStatus === 'paid' ? new Date() : null
      },
      { new: true }
    );

    if (!inscription) {
      return res.status(404).json({ message: 'Inscripción no encontrada.' });
    }

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

// @desc    Contar todas las inscripciones
// @route   GET /api/inscriptions/count
// @access  Public
export const countInscriptions = async (req: Request, res: Response) => {
  try {
    const total = await Inscription.countDocuments();
    const paid = await Inscription.countDocuments({ paymentStatus: 'paid' });
    const pending = await Inscription.countDocuments({ paymentStatus: 'pending' });

    res.status(200).json({
      success: true,
      data: { total, paid, pending },
    });
  } catch (error) {
    logError('countInscriptions', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ message: 'Error al contar las inscripciones.' });
  }
};
