import { Request, Response } from 'express';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import dotenv from 'dotenv';
import Inscription from '../../models/Inscription.js';
import Turno from '../../models/Turno.js';
import { logError } from '../../services/logger.js';
import { sendMetaConversionEvent } from '../../services/meta-capi-service.js';
import { Types } from 'mongoose';

dotenv.config();

const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not defined');
}
const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);

interface PaymentSuccessQuery {
  external_reference: string;
}

export const paymentSuccess = (req: Request<{}, {}, {}, PaymentSuccessQuery>, res: Response): void => {
  const { external_reference } = req.query;

  if (!external_reference) {
    res.status(400).send('Falta la referencia externa');
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('payment_ref', external_reference, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api',
    maxAge: 300000,
  });

  res.redirect(`${process.env.CORS_ORIGIN}/payment/success`);
};

export const getVerifiedPaymentData = async (req: Request, res: Response): Promise<void> => {
  const { payment_ref } = req.cookies;

  if (!payment_ref) {
    res.status(401).json({ message: 'No autorizado: Referencia de pago no encontrada.' });
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api',
  };

  try {
    const searchResult = await payment.search({
      options: {
        external_reference: payment_ref,
        sort: 'date_created',
        criteria: 'desc',
      },
    });

    const paymentResult = searchResult.results?.[0];

    if (!paymentResult || paymentResult.status !== 'approved') {
      res.clearCookie('payment_ref', cookieOptions);
      res.status(404).json({ message: 'Pago no encontrado o no aprobado.' });
      return;
    }
    
    const mpPaymentId: string = paymentResult.id!;
    const mpTransactionAmount: number = paymentResult.transaction_amount!;
    const mpPaymentMethod: string = paymentResult.payment_method_id || 'desconocido';
    const mpDateApproved: string = paymentResult.date_approved!;
    
    const inscriptionId = payment_ref;
    const inscription = await Inscription.findById(inscriptionId);

    if (inscription) {
      const paymentAlreadyExists = inscription.paymentHistory.some(p => p._id && p._id.toString() === mpPaymentId);

      if (!paymentAlreadyExists) {
        const newPayment = {
          _id: new Types.ObjectId(mpPaymentId),
          amount: mpTransactionAmount,
          paymentMethod: mpPaymentMethod,
          date: new Date(mpDateApproved),
          notes: `Pago #${mpPaymentId}`
        };

        inscription.paymentHistory.push(newPayment);

        const totalPaid = inscription.paymentHistory.reduce((sum, p) => sum + p.amount, 0);
        inscription.depositAmount = totalPaid;
        inscription.depositDate = new Date(mpDateApproved);
        
        if (totalPaid >= inscription.coursePrice) {
          inscription.paymentStatus = 'paid';
          inscription.paymentDate = new Date(mpDateApproved);
        } else {
          inscription.paymentStatus = 'partial';
        }

        if (!inscription.isReserved && inscription.turnoId) {
          await Turno.findByIdAndUpdate(inscription.turnoId, { $inc: { cuposInscriptos: 1 } });
          inscription.isReserved = true;
        }

        await inscription.save();

        if (inscription.paymentStatus === 'paid') {
          try {
            await sendMetaConversionEvent({
              eventName: 'Purchase',
              email: inscription.email,
              phone: inscription.celular,
              firstName: inscription.nombre,
              lastName: inscription.apellido,
              value: totalPaid,
              contentName: inscription.courseTitle,
              orderId: `purchase_mp_${inscriptionId}`,
              fbc: inscription.metaFbc,
              fbp: inscription.metaFbp,
              clientIpAddress: inscription.clientIpAddress,
              clientUserAgent: inscription.clientUserAgent,
              eventSourceUrl: 'https://modista-app.com/payment/success'
            });
          } catch (capiError) {
            logError('[Meta CAPI Purchase Error en MercadoPago]', capiError instanceof Error ? capiError : new Error(String(capiError)));
          }
        }
      }
    }

    const courseData = paymentResult.metadata.course;
    const paymentStatus = paymentResult.status;
    const paymentId = paymentResult.id;

    res.clearCookie('payment_ref', cookieOptions);

    res.status(200).json({
      course: courseData,
      payment: {
        id: paymentId,
        status: paymentStatus,
      },
    });

  } catch (error) {
    res.clearCookie('payment_ref', cookieOptions);
    res.status(500).json({ message: 'Error interno al verificar el pago.' });
  }
};
