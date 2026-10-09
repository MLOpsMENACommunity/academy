/* eslint-disable no-console -- a CLI tool */
// A TCP proxy that adds network latency, so a local load test sees database round trips
// like production's (container on Cloudflare -> Neon), not a loopback's ~0 ms. With ~0 ms
// round trips a small connection pool is never the bottleneck and the test misleads.
//
//   node loadtest/latency-proxy.mjs [listenPort=6543] [target=127.0.0.1:5432] [oneWayMs=10]
//
// Each chunk is delayed by oneWayMs in each direction (so ~2 × oneWayMs per round trip),
// preserving order.
import net from 'node:net';

const [listenPort = '6543', target = '127.0.0.1:5432', oneWay = '10'] = process.argv.slice(2);
const [targetHost, targetPort] = target.split(':');
const delay = Number(oneWay);

/** Pipes src to dst, each chunk delivered `delay` ms after it arrived, in order. */
function delayed(src, dst) {
  let chain = Promise.resolve();
  src.on('data', (chunk) => {
    const due = Date.now() + delay;
    chain = chain.then(() => new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())))).then(() => {
      if (!dst.destroyed) dst.write(chunk);
    });
  });
  src.on('end', () => void chain.then(() => dst.end()));
  src.on('error', () => dst.destroy());
}

net
  .createServer((client) => {
    const upstream = net.connect(Number(targetPort), targetHost);
    delayed(client, upstream);
    delayed(upstream, client);
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  })
  // Loopback only: it forwards to a database without asking for credentials of its own.
  // (Docker Desktop's host.docker.internal reaches the host's loopback.)
  .listen(Number(listenPort), process.env.LISTEN_HOST ?? '127.0.0.1', () => console.log(`latency proxy :${listenPort} -> ${target}, +${delay} ms each way`));
