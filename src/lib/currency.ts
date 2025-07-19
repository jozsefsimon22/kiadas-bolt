export const formatCurrency = (value: number, currency: string, options: Intl.NumberFormatOptions = {}) => {
  const defaultOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  
  return new Intl.NumberFormat('en-US', { ...defaultOptions, ...options }).format(value);
};
