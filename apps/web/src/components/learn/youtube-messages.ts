/** The only origin the lesson player talks to (the one the CSP's frame-src allows). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/** What makes the embedded player start reporting its state to this page. */
export const YOUTUBE_SUBSCRIBE_MESSAGES = [
  JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
  JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' }),
];

const ENDED = 0;

/** Whether a message from the embedded player says the video reached its end. Anything else: false. */
export function isVideoEndedMessage(raw: unknown): boolean {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  if (!m || typeof m !== 'object') return false;
  const { event, info } = m as { event?: unknown; info?: unknown };
  if (event === 'onStateChange') return info === ENDED;
  if (event === 'infoDelivery' && info && typeof info === 'object') return (info as { playerState?: unknown }).playerState === ENDED;
  return false;
}
