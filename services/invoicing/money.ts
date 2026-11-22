/** Amounts in pesos with two decimals: sums of floats (12345.67 + 0.1 + 0.2) must not reach ARCA or the QR with noise. */
export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
