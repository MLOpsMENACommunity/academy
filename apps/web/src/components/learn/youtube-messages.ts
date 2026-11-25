/** The only origin the lesson player talks to (the one the CSP's frame-src allows). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/** What makes the embedded player start reporting its state to this page. */
export const YOUTUBE_SUBSCRIBE_MESSAGES = [
  JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
  JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' }),
];

/** The player's states (YouTube IFrame API): -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
export const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

/** What a player message tells us; each field only when the message carries it. */
export interface PlayerInfo {
  /** Seconds into the video. */
  currentTime?: number;
  /** The video's length in seconds (0 until the player knows it). */
  duration?: number;
  playerState?: number;
}

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * A message from the embedded player, as what it says about the video: `onStateChange` carries the
 * state; `infoDelivery` (sent several times a second once we are listening) carries any of
 * currentTime, duration and playerState. Anything else, or nothing usable: null.
 */
export function parsePlayerMessage(raw: unknown): PlayerInfo | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const { event, info } = m as { event?: unknown; info?: unknown };
  if (event === 'onStateChange') {
    const playerState = finite(info);
    return playerState === undefined ? null : { playerState };
  }
  if (event !== 'infoDelivery' || !info || typeof info !== 'object') return null;
  const i = info as Record<string, unknown>;
  const out: PlayerInfo = {};
  const currentTime = finite(i.currentTime);
  const duration = finite(i.duration);
  const playerState = finite(i.playerState);
  if (currentTime !== undefined && currentTime >= 0) out.currentTime = currentTime;
  if (duration !== undefined && duration >= 0) out.duration = duration;
  if (playerState !== undefined) out.playerState = playerState;
  return Object.keys(out).length ? out : null;
}

/** Whether a message from the embedded player says the video reached its end. Anything else: false. */
export function isVideoEndedMessage(raw: unknown): boolean {
  return parsePlayerMessage(raw)?.playerState === PLAYER_STATE.ENDED;
}

/**
 * The embed's address: YouTube's privacy-enhanced player with the JS API on (for our postMessage
 * channel, answering only to `origin`), never autoplay unless asked (a click on our thumbnail), and
 * starting at `start` seconds when above 0.
 */
export function youtubeEmbedUrl(id: string, origin: string, opts: { start?: number; autoplay?: boolean } = {}): string {
  const q = new URLSearchParams({ enablejsapi: '1', rel: '0', origin });
  if (opts.autoplay) q.set('autoplay', '1');
  const start = Math.floor(opts.start ?? 0);
  if (start > 0) q.set('start', String(start));
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(id)}?${q.toString()}`;
}
