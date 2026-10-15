// A tiny in-memory stand-in for the private S3/R2 bucket, for test runs without MinIO
// (Cloudflare Workers Builds has no Docker services). It speaks just enough path-style S3
// for StorageService: HeadBucket, CreateBucket, PutObject, GetObject, DeleteObject.
// Signatures are not checked: it listens on 127.0.0.1 only and lives for one test run.
import { createServer } from 'node:http';

/** Decodes an aws-chunked body ("<hex size>[;chunk-signature=…]\r\n<data>\r\n … 0\r\n<trailers>"). */
function decodeAwsChunked(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i);
    if (eol < 0) break;
    const size = parseInt(buf.subarray(i, eol).toString('latin1').split(';')[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

const xmlError = (code, message) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;

/** Starts the server on a free port; resolves to { endpoint, close }. */
export async function startMemoryS3() {
  /** bucket -> key -> { body, contentType } */
  const buckets = new Map();

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      const slash = path.indexOf('/');
      const bucket = slash < 0 ? path : path.slice(0, slash);
      const key = slash < 0 ? '' : path.slice(slash + 1);
      const send = (status, body = '', headers = {}) => {
        res.writeHead(status, { 'x-amz-request-id': 'memory-s3', ...headers });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      const missingBucket = () => send(404, xmlError('NoSuchBucket', 'The specified bucket does not exist'), { 'content-type': 'application/xml' });

      if (!bucket) return send(400, xmlError('InvalidRequest', 'No bucket'), { 'content-type': 'application/xml' });
      if (!key) {
        if (req.method === 'HEAD') return buckets.has(bucket) ? send(200) : missingBucket();
        if (req.method === 'PUT') {
          if (!buckets.has(bucket)) buckets.set(bucket, new Map());
          return send(200, '', { location: `/${bucket}` });
        }
        return send(501, xmlError('NotImplemented', `${req.method} on a bucket`), { 'content-type': 'application/xml' });
      }
      const objects = buckets.get(bucket);
      if (!objects) return missingBucket();
      switch (req.method) {
        case 'PUT': {
          let body = Buffer.concat(chunks);
          const streaming = String(req.headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING-');
          if (streaming || String(req.headers['content-encoding'] ?? '').includes('aws-chunked')) body = decodeAwsChunked(body);
          objects.set(key, { body, contentType: req.headers['content-type'] ?? 'application/octet-stream' });
          return send(200, '', { etag: `"${body.length.toString(16)}"` });
        }
        case 'GET':
        case 'HEAD': {
          const obj = objects.get(key);
          if (!obj) return send(404, xmlError('NoSuchKey', 'The specified key does not exist.'), { 'content-type': 'application/xml' });
          return send(200, obj.body, { 'content-type': obj.contentType, 'content-length': String(obj.body.length) });
        }
        case 'DELETE':
          objects.delete(key);
          return send(204);
        default:
          return send(501, xmlError('NotImplemented', req.method), { 'content-type': 'application/xml' });
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
