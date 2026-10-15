// A Postgres wire-protocol proxy that works around one bug in @electric-sql/pglite-socket
// (0.2.12 with PGlite 0.5.9): after an ErrorResponse the server sends ReadyForQuery twice
// (E, Z, Z). Prisma's driver takes the extra one as a protocol violation and drops the
// connection ("Server has closed the connection", P1017), so every SQL error in a test (a
// unique violation the code expects and handles, for instance) broke the next query.
//
// The proxy drops exactly that signature: a ReadyForQuery ('Z') that directly follows a
// ReadyForQuery which itself directly followed an ErrorResponse ('E'). It doesn't count
// requests, so a client that pipelines several Syncs is unaffected. Everything else passes
// through untouched.
import { createConnection, createServer } from 'node:net';

const SSL_REQUEST = 80877103;
const GSSENC_REQUEST = 80877104;

/** Starts the proxy on a free 127.0.0.1 port in front of `upstream` ("host:port"). */
export async function startReadyForQueryGuard(upstream) {
  const colon = upstream.lastIndexOf(':');
  const upHost = upstream.slice(0, colon);
  const upPort = Number(upstream.slice(colon + 1));
  let dropped = 0;

  const server = createServer((client) => {
    const db = createConnection({ host: upHost, port: upPort });
    // Before the startup message, the client may ask for SSL/GSS encryption; the server
    // answers each such request with one bare byte ('N'), not a framed message.
    let startup = true;
    let rawBytesExpected = 0;
    let fromClient = Buffer.alloc(0);
    let fromDb = Buffer.alloc(0);
    let previous = ''; // type of the last message from the server
    let previousZFollowedError = false;

    client.on('data', (chunk) => {
      if (startup) {
        fromClient = Buffer.concat([fromClient, chunk]);
        while (startup && fromClient.length >= 8) {
          const len = fromClient.readInt32BE(0);
          if (fromClient.length < len) break;
          const code = fromClient.readInt32BE(4);
          if (code === SSL_REQUEST || code === GSSENC_REQUEST) rawBytesExpected++;
          else startup = false;
          fromClient = fromClient.subarray(len);
        }
        if (!startup) fromClient = Buffer.alloc(0);
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
        const type = String.fromCharCode(message[0]);
        if (type === 'Z') {
          if (previous === 'Z' && previousZFollowedError) {
            dropped++;
            previousZFollowedError = false;
            continue; // the duplicate: E, Z, [Z]
          }
          previousZFollowedError = previous === 'E';
        }
        previous = type;
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
