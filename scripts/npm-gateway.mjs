/** Built-in Node HTTP gateway: /api and /health -> Express, everything else -> React SSR.
 * Never forwards caller-supplied proxy address headers to the private API. */
import http from 'node:http';

export function createNpmGateway({ apiPort, frontendPort, apiHost = '127.0.0.1', frontendHost = '127.0.0.1' }) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    const isApi = pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/');
    const port = isApi ? apiPort : frontendPort;
    const host = isApi ? apiHost : frontendHost;
    const headers = { ...request.headers };
    for (const name of ['x-forwarded-for', 'x-real-ip', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'proxy-authorization']) {
      delete headers[name];
    }
    // The private backend explicitly trusts exactly one hop; set it ourselves.
    const remoteAddress = request.socket.remoteAddress || '127.0.0.1';
    headers['x-forwarded-for'] = remoteAddress;
    headers['x-real-ip'] = remoteAddress;
    headers['x-forwarded-proto'] = request.socket.encrypted ? 'https' : 'http';
    const upstream = http.request({ host, port, method: request.method, path: request.url, headers }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Girder service unavailable');
      } else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}
