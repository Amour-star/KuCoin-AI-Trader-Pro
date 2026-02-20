export const API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_PROXY_BASE = '/api';

if (process.env.NODE_ENV !== 'production') {
  console.log('API URL:', process.env.NEXT_PUBLIC_API_URL);
  console.log('API_PROXY_BASE:', API_PROXY_BASE);
}
