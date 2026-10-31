/**
 * Every Redis key the analytics pipeline touches, in one place.
 *
 * These are shared across three files — the producer (events), the consumer
 * and the flusher. Defined separately in each, a rename in one place would
 * leave the others reading or writing a key nobody else uses: no error,
 * just counts that silently stop moving.
 */
export const VISIT_STREAM = "link:visits";
export const VISIT_GROUP = "analytics-workers";
export const VISIT_COUNTS_HASH = "link:visit-counts";
export const VISIT_COUNTS_PROCESSING = "link:visit-counts:processing";

/** Approximate cap on stream length; "~" lets Redis trim at node boundaries. */
export const VISIT_STREAM_MAXLEN = 100_000;
