
import dotenv from 'dotenv';
dotenv.config();

import { MercadoPagoConfig, Preference } from 'mercadopago';

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

export const createPreference = async (req, res) => {
  const { course, external_reference } = req.body;
  const { title, price, shortDescription } = course;

  try {
    const preference = {
      items: [
        {
          title,
          unit_price: Number(price),
          shortDescription,
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
    };

    const pref = new Preference(client);
    const response = await pref.create({ body: preference });
    console.log('Mercado Pago API Response:', response); // Nuevo log
    res.json({ preferenceId: response.body.id });
  } catch (error) {
    console.error('Error creating preference:', error);
    console.error('Error details:', error); // Nuevo log
    res.status(500).json({ error: 'Failed to create preference' });
  }
};
