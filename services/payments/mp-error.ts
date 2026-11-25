type MercadoPagoErrorDetails = {
  errorMessage: string;
  providerCode?: string;
  providerStatus?: number;
};

const safeText = (value: string): string => value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .slice(0, 300);

export const describeMercadoPagoError = (error: unknown): MercadoPagoErrorDetails => {
  if (error instanceof Error) return { errorMessage: safeText(error.message) };
  if (typeof error === 'string') return { errorMessage: safeText(error) };
  if (typeof error !== 'object' || error === null) {
    return { errorMessage: 'Error no identificado de Mercado Pago' };
  }

  const details = error as Record<string, unknown>;
  return {
    errorMessage: typeof details.message === 'string' ? safeText(details.message) : 'Error no identificado de Mercado Pago',
    ...(typeof details.error === 'string' ? { providerCode: safeText(details.error) } : {}),
    ...(typeof details.status === 'number' ? { providerStatus: details.status } : {}),
  };
};
