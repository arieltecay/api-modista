import { Request, Response, NextFunction } from 'express';
import Inscription from '../../models/Inscription.js';
import { logError } from '../../services/logger.js';
import { IInscription } from '../../models/Inscription.js'; // Importamos la interfaz
import ExcelJS from 'exceljs';

// --- Interfaces para tipado ---

interface CreateInscriptionBody {
  nombre: string;
  apellido: string;
  email: string;
  celular: string;
  courseId: string;
  courseTitle: string;
  coursePrice: number;
}

interface GetInscriptionsQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: keyof IInscription;
  sortOrder?: 'asc' | 'desc';
}

interface UpdatePaymentStatusBody {
    paymentStatus: 'pending' | 'paid';
}

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

    const existingInscription = await Inscription.findOne({ email: email, courseId: courseId });

    if (existingInscription) {
      return res.status(409).json({ success: false, message: 'Ya te encuentras inscripto en este curso.' });
    }

    const inscription = await Inscription.create(req.body);
    res.status(201).json({
      success: true,
      data: inscription,
    });
  } catch (error) {
    // Manejo de error de duplicado de email (código 11000 de MongoDB)
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        return res.status(400).json({ success: false, message: 'Este email ya ha sido registrado.' });
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido del servidor';
    res.status(500).json({ success: false, message: 'Error del servidor', error: errorMessage });
  }
};

// @desc    Obtener todas las inscripciones con paginación
// @route   GET /api/inscriptions
// @access  Private (Protected by JWT + Admin role)
export const getInscriptions = async (req: Request<{}, {}, {}, GetInscriptionsQuery>, res: Response) => {
  const { page = '1', limit = '10', search, sortBy, sortOrder } = req.query;

  try {
    let queryFilter = {};
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
// @access  Public
export const exportInscriptions = async (req: Request, res: Response) => {
  try {
    const inscriptions = await Inscription.find().sort({ fechaInscripcion: -1 });

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
