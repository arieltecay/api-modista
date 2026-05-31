import Inscription from '../../models/Inscription.js';
import { sendWhatsAppTemplate } from '../../services/whatsapp-official-service.js';
import { logError } from '../../services/logger.js';

/**
 * Servicio de Recuperación de Inscripciones Abandonadas
 */
export const runInscriptionsRecovery = async () => {
  const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // FECHA DE CORTE: Solo recuperar inscripciones creadas después de hoy (30 de mayo de 2026)
  // para no enviar mensajes a leads antiguos.
  const CUTOFF_DATE = new Date('2026-05-30T22:50:00Z'); 

  try {
    // Buscar inscripciones pendientes:
    // 1. paymentStatus sea 'pending'
    // 2. Creadas hace más de 2 horas
    // 3. Creadas hace menos de 24 horas
    // 4. Que no se les haya enviado el mensaje de recuperación todavía
    // 5. Creadas después de la fecha de corte técnica
    const pendingInscriptions = await Inscription.find({
      paymentStatus: 'pending',
      fechaInscripcion: { 
        $lte: TWO_HOURS_AGO, 
        $gte: TWENTY_FOUR_HOURS_AGO,
        $gt: CUTOFF_DATE 
      },
      recoveryMessageSent: false,
      celular: { $exists: true, $ne: '' }
    });

    console.log(`[Recovery Engine] Encontradas ${pendingInscriptions.length} inscripciones para recuperar.`);

    let successCount = 0;

    for (const inscription of pendingInscriptions) {
      try {
        // Preparamos los componentes para la plantilla 'recordatorio_inscripcion_v1'
        // Variables: {{1}} = nombre, {{2}} = curso
        const components = [
          {
            type: 'body',
            parameters: [
              { 
                type: 'text', 
                parameter_name: 'nombre_alumno', // Usamos el nombre descriptivo si la plantilla lo soporta
                text: inscription.nombre 
              },
              { 
                type: 'text', 
                parameter_name: 'nombre_curso', 
                text: inscription.courseTitle 
              }
            ]
          }
        ];

        const sent = await sendWhatsAppTemplate(
          inscription.celular, 
          'recordatorio_inscripcion_v1', 
          components, 
          'es_AR'
        );

        if (sent) {
          inscription.recoveryMessageSent = true;
          inscription.recoveryMessageAt = new Date();
          await inscription.save();
          successCount++;
        }
      } catch (err) {
        logError(`[Recovery Engine] Error procesando id ${inscription._id}`, err instanceof Error ? err : new Error(String(err)));
      }
    }

    return {
      processed: pendingInscriptions.length,
      sent: successCount
    };

  } catch (error) {
    logError('[Recovery Engine] Error general', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
};
