import mongoose from 'mongoose';
import Course from '../../models/Course.js';
import Inscription from '../../models/Inscription.js';
import MonthlyClosureReport from '../../models/MonthlyClosureReport.js';
import { generateCsvReport } from '../report/report-service.js';
import { EntityNotFoundError } from '../../utils/errors.js';

/**
 * @description Procesa el cierre mensual de un curso.
 * Como Principal Software Architect, garantizo la atomicidad vía transacciones de Mongoose.
 */
export const processMonthlyClosureService = async (courseId: string, closureDate: Date) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Resolver el curso (usando UUID como es estándar en este proyecto)
    const course = await Course.findOne({ uuid: courseId }).session(session);
    if (!course) {
      throw new EntityNotFoundError('Curso no encontrado');
    }

    // Definir el rango del ciclo actual
    const startDate = course.currentPaymentCycleStartDate || course.createdAt || new Date(0);
    
    // 2. Obtener inscripciones asociadas al curso
    const inscriptions = await Inscription.find({ courseId: course.uuid }).session(session);
    
    const paymentReportData: any[] = [];
    let totalAmountCollected = 0;

    // 3. Filtrar y procesar pagos en el historial de cada inscripción
    inscriptions.forEach(ins => {
      if (ins.paymentHistory && ins.paymentHistory.length > 0) {
        const cyclePayments = ins.paymentHistory.filter(p => {
          const paymentDate = new Date(p.date);
          return paymentDate >= startDate && paymentDate <= closureDate;
        });
        
        cyclePayments.forEach(p => {
          totalAmountCollected += p.amount;
          paymentReportData.push({
            Alumno: `${ins.nombre} ${ins.apellido}`,
            Email: ins.email,
            Celular: ins.celular,
            Fecha: p.date.toISOString().split('T')[0],
            Monto: p.amount,
            Metodo: p.paymentMethod || 'N/A',
            Notas: p.notes || ''
          });
        });
      }
    });

    // 4. Generar Reporte CSV si hubo movimientos o reporte vacío informativo
    const fileNameBase = course.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const reportUrl = await generateCsvReport(
      paymentReportData, 
      ['Alumno', 'Email', 'Celular', 'Fecha', 'Monto', 'Metodo', 'Notas'],
      `cierre-${fileNameBase}`
    );

    // 5. Persistir el reporte de cierre
    const closureReport = new MonthlyClosureReport({
      courseId: course._id,
      closureDate,
      paymentMonth: closureDate.getMonth() + 1,
      paymentYear: closureDate.getFullYear(),
      totalAmountCollected,
      reportUrl
    });
    await closureReport.save({ session });

    // 6. Actualizar el estado del curso para el próximo ciclo
    course.lastMonthlyClosureDate = closureDate;
    const nextDay = new Date(closureDate);
    nextDay.setDate(nextDay.getDate() + 1);
    course.currentPaymentCycleStartDate = nextDay;
    await course.save({ session });

    // 7. Consolidar cambios
    await session.commitTransaction();
    return closureReport;

  } catch (error) {
    // 8. Revertir en caso de fallo crítico
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * @description Recupera los reportes de cierre mensual de un curso.
 */
export const getMonthlyReportsService = async (courseId: string, page: number, limit: number) => {
  const course = await Course.findOne({ uuid: courseId });
  if (!course) throw new EntityNotFoundError('Curso no encontrado');

  const options = {
    page,
    limit,
    sort: { closureDate: -1 },
    populate: { path: 'courseId', select: 'title uuid' }
  };

  return await (MonthlyClosureReport as any).paginate({ courseId: course._id }, options);
};
