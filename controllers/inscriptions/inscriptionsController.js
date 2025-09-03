import Inscription from '../../models/Inscription.js';
import xlsx from 'xlsx';
import { logError } from '../../services/logger.js';

// @desc    Crear una nueva inscripción
// @route   POST /api/inscriptions
// @access  Public
export const createInscription = async (req, res, next) => {
  try {
    const { nombre, apellido, email, celular, courseId, courseTitle, coursePrice } = req.body;

    // Validación básica
    if (!nombre || !apellido || !email || !celular || !courseId || !courseTitle || coursePrice == null) {
      return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }

    const inscription = await Inscription.create(req.body);
    res.status(201).json({
      success: true,
      data: inscription,
    });
  } catch (error) {
    // Manejo de error de duplicado de email
    if (error.code === 11000) {
        return res.status(400).json({ success: false, message: 'Este email ya ha sido registrado.' });
    }
    res.status(500).json({ success: false, message: 'Error del servidor', error: error.message });
  }
};

// @desc    Obtener todas las inscripciones con paginación
// @route   GET /api/inscriptions
// @access  Private (Protected by secret key)
export const getInscriptions = async (req, res) => {
    const { page = 1, limit = 10, secret, search, sortBy, sortOrder } = req.query;

    if (secret !== process.env.ADMIN_SECRET_KEY) {
        logError('getAllInscriptions', new Error('Intento de acceso no autorizado a inscripciones'));
        return res.status(403).json({ message: 'Acceso denegado.' });
    }

    try {
        // 1. Construir el filtro de búsqueda
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

        // 2. Construir las opciones de paginación y ordenamiento
        const sortOptions = {};
        if (sortBy) {
            sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
        } else {
            sortOptions.fechaInscripcion = -1; // Orden por defecto
        }

        const options = {
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            sort: sortOptions
        };

        // 3. Ejecutar la consulta con paginación, filtro y ordenamiento
        const result = await Inscription.paginate(queryFilter, options);

        res.status(200).json({
            data: result.docs,
            total: result.totalDocs,
            totalPages: result.totalPages,
            currentPage: result.page,
        });
    } catch (error) {
        logError('getAllInscriptions', error);
        res.status(500).json({ message: 'Error al obtener las inscripciones.' });
    }
};


// @desc    Exportar inscripciones a XLS
// @route   GET /api/inscriptions/export
// @access  Public (or could be protected)
export const exportInscriptions = async (req, res, next) => {
  try {
    const inscriptions = await Inscription.find().sort({ fechaInscripcion: -1 });

    const data = inscriptions.map(inscription => ({
      Nombre: inscription.nombre,
      Apellido: inscription.apellido,
      Email: inscription.email,
      Celular: inscription.celular,
      Curso: inscription.courseTitle,
      Precio: inscription.coursePrice,
      'Estado de Pago': inscription.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente',
      'Fecha de Inscripción': inscription.fechaInscripcion.toLocaleDateString('es-AR'),
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Inscripciones');

    // Set headers to trigger download
    res.setHeader('Content-Disposition', 'attachment; filename="inscripciones.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.send(buffer);

  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al exportar los datos', error: error.message });
  }
};

// @desc    Actualizar estado de pago de una inscripción
// @route   PATCH /api/inscriptions/:id/payment-status
// @access  Private (Protected by secret key)
export const updatePaymentStatus = async (req, res) => {
  const { id } = req.params;
  const { paymentStatus, secret } = req.body;

  // Validar acceso admin
  if (secret !== process.env.ADMIN_SECRET_KEY) {
    logError('updatePaymentStatus', new Error('Intento de acceso no autorizado'));
    return res.status(403).json({ message: 'Acceso denegado.' });
  }

  // Validar estado de pago
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
      message: `Estado actualizado a ${paymentStatus === 'paid' ? 'pagado' : 'pendiente'}`
    });
  } catch (error) {
    logError('updatePaymentStatus', error);
    res.status(500).json({ message: 'Error al actualizar estado de pago.' });
  }
};