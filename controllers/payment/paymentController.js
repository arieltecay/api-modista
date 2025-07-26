
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
        success: `${process.env.URL_LOCAL}/payment-success`,
        failure: `${process.env.URL_LOCAL}/payment-failure`,
        pending: `${process.env.URL_LOCAL}/payment-pending`,
      },
      auto_return: 'approved',
    };

    const pref = new Preference(client);
    const response = await pref.create({ body: preference });
    res.json({ preferenceId: response.body.id });
  } catch (error) {
    console.error('Error creating preference:', error);
    res.status(500).json({ error: 'Failed to create preference' });
  }
};
