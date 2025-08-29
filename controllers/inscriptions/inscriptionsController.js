import Inscription from '../../models/Inscription.js';
import xlsx from 'xlsx';

// @desc    Crear una nueva inscripción
// @route   POST /api/inscriptions
// @access  Public
export const createInscription = async (req, res, next) => {
  try {
    const { nombre, apellido, email, celular } = req.body;

    // Validación básica
    if (!nombre || !apellido || !email || !celular) {
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
export const getInscriptions = async (req, res, next) => {
    // Simple secret key auth
    if (req.query.secret !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ success: false, message: 'No autorizado' });
    }

    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const inscriptions = await Inscription.find().skip(skip).limit(limit).sort({ fechaInscripcion: -1 });
        const total = await Inscription.countDocuments();

        res.status(200).json({
            success: true,
            count: inscriptions.length,
            total,
            pagination: {
                totalPages: Math.ceil(total / limit),
                currentPage: page,
            },
            data: inscriptions,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error del servidor', error: error.message });
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