import Redis from 'ioredis';

/**
 * Versioned event envelope. Every event that crosses the Redis Streams
 * transport is wrapped in this shape so that a future transport swap
 * (e.g. Kafka) only has to preserve this envelope, not every call site.
 */
export interface EventEnvelope<T = unknown> {
  version: 1;
  type: string;
  data: T;
  publishedAt: string;
}

export interface ConsumedEvent<T = unknown> {
  id: string; // stream entry id
  envelope: EventEnvelope<T>;
}

/**
 * Publish a versioned event onto a Redis Stream.
 */
export async function publishEvent<T>(
  redis: Redis,
  stream: string,
  type: string,
  data: T
): Promise<string> {
  const envelope: EventEnvelope<T> = {
    version: 1,
    type,
    data,
    publishedAt: new Date().toISOString(),
  };
  return redis.xadd(stream, '*', 'payload', JSON.stringify(envelope)) as Promise<string>;
}

export interface ConsumeOptions {
  /** Name for this consumer within the group (defaults to a random id). */
  consumerName?: string;
  /** Block duration (ms) for XREADGROUP. Default 5000. */
  blockMs?: number;
  /** Number of entries to read per batch. Default 10. */
  count?: number;
  /** AbortSignal to stop the consume loop gracefully. */
  signal?: AbortSignal;
}

/**
 * Consume events from a Redis Stream using a consumer group, calling
 * `handler` for each event and XACK'ing on success. Runs until `signal`
 * aborts. Creates the consumer group if it doesn't exist yet.
 *
 * A second ioredis connection must be supplied (blocking XREADGROUP calls
 * hold the connection, so it must be dedicated, not shared with other
 * commands).
 */
export async function consumeEvents<T>(
  redis: Redis,
  stream: string,
  groupName: string,
  handler: (event: ConsumedEvent<T>) => Promise<void> | void,
  options: ConsumeOptions = {}
): Promise<void> {
  const consumerName = options.consumerName ?? `consumer-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const blockMs = options.blockMs ?? 5000;
  const count = options.count ?? 10;

  try {
    await redis.xgroup('CREATE', stream, groupName, '$', 'MKSTREAM');
  } catch (err: any) {
    if (!String(err?.message ?? err).includes('BUSYGROUP')) {
      throw err;
    }
  }

  while (!options.signal?.aborted) {
    let response: [string, [string, string[]][]][] | null;
    try {
      response = (await redis.xreadgroup(
        'GROUP',
        groupName,
        consumerName,
        'COUNT',
        count,
        'BLOCK',
        blockMs,
        'STREAMS',
        stream,
        '>'
      )) as unknown as [string, [string, string[]][]][] | null;
    } catch (err) {
      if (options.signal?.aborted) return;
      throw err;
    }

    if (!response) continue;

    for (const [, entries] of response) {
      for (const [id, fields] of entries) {
        const payloadIdx = fields.indexOf('payload');
        const raw = payloadIdx >= 0 ? fields[payloadIdx + 1] : undefined;
        if (!raw) {
          await redis.xack(stream, groupName, id);
          continue;
        }
        try {
          const envelope = JSON.parse(raw) as EventEnvelope<T>;
          await handler({ id, envelope });
          await redis.xack(stream, groupName, id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[events] handler failed for ${stream} entry ${id}`, err);
          // Not ack'd: will be redelivered / visible via XPENDING for inspection.
        }
      }
    }
  }
}

/** Simple pub/sub helper for ephemeral, non-authoritative events (e.g. presence). */
export async function publishPresence<T>(redis: Redis, channel: string, data: T): Promise<void> {
  const envelope: EventEnvelope<T> = {
    version: 1,
    type: channel,
    data,
    publishedAt: new Date().toISOString(),
  };
  await redis.publish(channel, JSON.stringify(envelope));
}

export function subscribePresence<T>(
  redis: Redis,
  channel: string,
  handler: (envelope: EventEnvelope<T>) => void
): void {
  redis.subscribe(channel);
  redis.on('message', (ch, message) => {
    if (ch !== channel) return;
    try {
      handler(JSON.parse(message) as EventEnvelope<T>);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[events] failed to parse presence message on ${channel}`, err);
    }
  });
}

export { Redis };
