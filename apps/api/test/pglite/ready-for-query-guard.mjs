// A Postgres wire-protocol proxy that works around one bug in @electric-sql/pglite-socket
// (0.2.12 with PGlite 0.5.9): after an ErrorResponse in the extended protocol the server sends
// ReadyForQuery twice. Prisma's driver takes the extra one as a protocol violation and drops
// the connection ("Server has closed the connection", P1017), so every SQL error in a test
// (a unique violation the code expects and handles, for instance) broke the next query.
//
// The protocol has exactly one ReadyForQuery ('Z') per client Sync ('S') or simple Query
// ('Q'), plus one after startup. The proxy counts those and drops any 'Z' beyond them.
// Everything else passes through untouched.
import { createConnection, createServer } from 'node:net';

const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;

/** Starts the proxy on a free 127.0.0.1 port in front of `upstream` ("host:port"). */
export async function startReadyForQueryGuard(upstream) {
  const [upHost, upPort] = [upstream.slice(0, upstream.lastIndexOf(':')), Number(upstream.slice(upstream.lastIndexOf(':') + 1))];
  let dropped = 0;

  const server = createServer((client) => {
    const db = createConnection({ host: upHost, port: upPort });
    let allowed = 0; // ReadyForQuery messages the client is waiting for
    let rawBytesExpected = 0; // single-byte answers to an SSL/GSS request ('N' or 'S')
    let startup = true; // the client's first messages carry no type byte
    let fromClient = Buffer.alloc(0);
    let fromDb = Buffer.alloc(0);

    client.on('data', (chunk) => {
      fromClient = Buffer.concat([fromClient, chunk]);
      for (;;) {
        if (startup) {
          if (fromClient.length < 8) break;
          const len = fromClient.readInt32BE(0);
          if (fromClient.length < len) break;
          const code = fromClient.readInt32BE(4);
          if (code === SSL_REQUEST || code === GSSENC_REQUEST) rawBytesExpected++;
          else {
            startup = false;
            allowed++; // the ReadyForQuery that ends authentication
          }
          fromClient = fromClient.subarray(len);
          continue;
        }
        if (fromClient.length < 5) break;
        const len = fromClient.readInt32BE(1);
        if (fromClient.length < len + 1) break;
        const type = String.fromCharCode(fromClient[0]);
        if (type === 'S' || type === 'Q') allowed++;
        fromClient = fromClient.subarray(len + 1);
      }
      db.write(chunk);
    });

    db.on('data', (chunk) => {
      fromDb = Buffer.concat([fromDb, chunk]);
      const out = [];
      for (;;) {
        if (rawBytesExpected > 0 && fromDb.length >= 1) {
          out.push(fromDb.subarray(0, 1));
          fromDb = fromDb.subarray(1);
          rawBytesExpected--;
          continue;
        }
        if (fromDb.length < 5) break;
        const len = fromDb.readInt32BE(1);
        if (fromDb.length < len + 1) break;
        const message = fromDb.subarray(0, len + 1);
        fromDb = fromDb.subarray(len + 1);
        if (message[0] === 0x5a /* Z */) {
          if (allowed === 0) {
            dropped++;
            continue;
          }
          allowed--;
        }
        out.push(message);
      }
      if (out.length) client.write(Buffer.concat(out));
    });

    const end = () => {
      client.destroy();
      db.destroy();
    };
    client.on('close', end);
    db.on('close', end);
    client.on('error', end);
    db.on('error', end);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    conn: `127.0.0.1:${port}`,
    dropped: () => dropped,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // Open client connections would keep close() waiting: the test run is over.
        server.unref();
        setTimeout(resolve, 1000).unref();
      }),
  };
}
