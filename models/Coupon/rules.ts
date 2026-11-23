/** Rules of a coupon that the model, the API schema and the checkout all share. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
/** What a person may type: ASCII only, checked before uppercasing (`toUpperCase` turns 'ß' into 'SS', 'ı' into 'I'). */
export const COUPON_CODE_INPUT_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
export const COUPON_CODE_MAX_LENGTH = 32;
export const COUPON_MAX_PERCENT = 99;

export const COUPON_CODE_MESSAGE = 'El código admite letras, números, guion y guion bajo (3 a 32)';
export const COUPON_PERCENT_MESSAGE = `El porcentaje máximo es ${COUPON_MAX_PERCENT}`;
export const COUPON_WINDOW_MESSAGE = 'La fecha de fin no puede ser anterior a la de inicio';
/** The seats of a coupon live in one document, so its cap is bounded. */
export const COUPON_MAX_USES_LIMIT = 10000;
