import type { IncomingMessage, ServerResponse } from 'http';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export default async function handler(req: IncomingMessage & { query?: { path?: string[] } }, res: ServerResponse) {
  const backendBase = process.env.NEXT_PUBLIC_API_URL;

  if (!backendBase) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'NEXT_PUBLIC_API_URL is not configured' }));
    return;
  }

  try {
    const pathSegments = Array.isArray(req.query?.path) ? req.query?.path : [];
    const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${backendBase.replace(/\/+$/, '')}/api/${pathSegments.join('/')}${search}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      headers.set(key, Array.isArray(value) ? value.join(',') : value);
    }

    const bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : bodyBuffer,
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const responseBuffer = Buffer.from(await response.arrayBuffer());
    res.end(responseBuffer);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Proxy request failed', details: error instanceof Error ? error.message : 'unknown' }));
  }
}
