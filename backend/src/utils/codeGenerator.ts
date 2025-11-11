/**
 * Generate a secure connection code
 * Format: 12-character alphanumeric (uppercase letters and numbers)
 * Example: A1B2C3D4E5F6
 * Total combinations: 36^12 = ~4.7 quadrillion
 */
export function generateConnectionCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let i = 0; i < 12; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    code += chars[randomIndex];
  }

  return code;
}

/**
 * Format code for display (adds hyphens every 4 characters)
 * Example: A1B2C3D4E5F6 -> A1B2-C3D4-E5F6
 */
export function formatCodeForDisplay(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') || code;
}
