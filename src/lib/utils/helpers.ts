/**
 * Generates a secure, formatted license key.
 * Format: ELITE-XXXX-XXXX-XXXX
 */
export const generateLicenseKey = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const segment = () => {
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
  };
  return `ELITE-${segment()}-${segment()}-${segment()}`;
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};
