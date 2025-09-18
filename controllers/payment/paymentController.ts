
import { Request, Response } from 'express';
import dotenv from 'dotenv';
import { logError } from '../../services/logger.js';
dotenv.config();

import { MercadoPagoConfig, Preference } from 'mercadopago';

const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
if (!accessToken) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN is not defined');
}
const client = new MercadoPagoConfig({ accessToken });

// Interface para el body de createPreference
interface CreatePreferenceBody {
  course: {
    title: string;
    price: string | number;
    shortDescription: string;
  };
  external_reference: string;
}

export const createPreference = async (req: Request<{}, {}, CreatePreferenceBody>, res: Response): Promise<void> => {
  const { course, external_reference } = req.body;
  const { title, price, shortDescription } = course;

  try {
    const preference = {
      items: [
        {
          id: title, // Add id as required by MercadoPago
          title,
          unit_price: Number(price),
          description: shortDescription,
          quantity: 1,
          currency_id: 'ARS',
        },
      ],
      external_reference: external_reference,
      back_urls: {
        success: `${process.env.VITE_API_URL}/api/payment/success`,
        failure: `${process.env.CORS_ORIGIN}/payment/failure`,
        pending: `${process.env.CORS_ORIGIN}/payment/pending`,
      },
      auto_return: 'approved',
      metadata: { course },
    };

    const pref = new Preference(client);
    const response = await pref.create({ body: preference });
    console.log('Mercado Pago API Response:', response); // Nuevo log
    res.json({ preferenceId: response.id });
  } catch (error) {
    logError("createPreference", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create preference' });
  }
};
