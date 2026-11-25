interface ConfirmationPaymentLinkInput {
  coursePrice: number;
  inscriptionId: string;
  frontendUrl: string;
  isDevelopment?: boolean;
  mpInitPoint?: string | null;
  sandboxInitPoint?: string | null;
  activePaymentLink?: string | null;
}

export const confirmationPaymentLink = ({
  coursePrice,
  inscriptionId,
  frontendUrl,
  isDevelopment,
  mpInitPoint,
  sandboxInitPoint,
  activePaymentLink,
}: ConfirmationPaymentLinkInput): string => {
  const paymentUrl = (isDevelopment ? sandboxInitPoint || mpInitPoint : mpInitPoint) || activePaymentLink;
  if (paymentUrl) {
    const separator = paymentUrl.includes('?') ? '&' : '?';
    return `${paymentUrl}${separator}utm_source=email&utm_medium=email&utm_campaign=payment_reminder`;
  }
  if (coursePrice > 0) {
    return `${frontendUrl}/payment/failure?inscription_id=${encodeURIComponent(inscriptionId)}&reason=checkout_unavailable`;
  }
  return '';
};
