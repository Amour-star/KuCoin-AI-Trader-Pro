export const API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_PROXY_BASE = '/api';

if (!API_URL) {
  console.warn(
    'NEXT_PUBLIC_API_URL is not defined. Check Vercel environment variables.',
  );
}

if (process.env.NODE_ENV !== 'production') {
  console.log('API_URL:', API_URL);
  console.log('API_PROXY_BASE:', API_PROXY_BASE);
}
