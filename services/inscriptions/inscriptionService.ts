import Inscription from '../../models/Inscription.js';
import { validateInscriptionData } from './inscriptionValidator.js';
import { sendEmail } from '../../services/emailServices.js';
import { InscriptionBody, CreateInscriptionResult } from './types.js';

export const createInscription = async (body: InscriptionBody): Promise<CreateInscriptionResult> => {
  const validation = await validateInscriptionData(body);
  
  if (!validation.valid) {
    const error = validation.error!;
    const err = new Error(error.message) as any;
    err.statusCode = error.status;
    throw err;
  }

  const inscriptionData = {
    ...body,
    courseId: validation.finalCourseId,
  };

  const inscription = await Inscription.create(inscriptionData);

  // Enviar email de confirmación con link de pago
  try {
    await sendEmail({
      to: inscription.email,
      subject: `Confirmación de tu Inscripción - ${inscription.courseTitle}`,
      templateName: 'teamplate',
      data: {
        name: `${inscription.nombre} ${inscription.apellido}`,
        courseTitle: inscription.courseTitle,
        price: inscription.coursePrice.toString(),
        paymentLink: validation.resolvedCourse!.mpPaymentLink || '',
        year: new Date().getFullYear().toString(),
      },
    });
  } catch (err) {
    console.error('Error sending confirmation email:', err);
  }

  return {
    success: true,
    data: inscription,
    mpPaymentLink: validation.resolvedCourse!.mpPaymentLink || null,
  };
};
