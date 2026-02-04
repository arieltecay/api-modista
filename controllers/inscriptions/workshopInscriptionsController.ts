import { Request, Response } from 'express';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import { logError } from '../../services/logger.js';
import { GetInscriptionsQuery, ExportInscriptionsQuery } from './types.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

/**
 * @desc    Obtener inscripciones exclusivas de un taller presencial
 * @route   GET /api/workshop-inscriptions/:workshopId
 * @access  Private (Admin)
 */
export const getWorkshopInscriptions = async (req: Request<{ workshopId: string }, {}, {}, GetInscriptionsQuery>, res: Response) => {
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
export const exportWorkshopInscriptions = async (req: Request<{ workshopId: string }, {}, {}, ExportInscriptionsQuery>, res: Response) => {
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
