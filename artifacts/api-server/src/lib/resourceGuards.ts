import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ServiceError } from "./errors";

export type NotesTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const RESOURCE_LIMITS = Object.freeze({ requestsPerMinute: 120, writesPerMinute: 20, notes: 1000, noteBytes: 100 * 1024 * 1024 });

function requireOwner(userId: string) {
  if (!userId || typeof userId !== "string") throw new ServiceError(401, "Authentication required");
}

function busyError(error: unknown): never {
  const code = (error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code;
  if (code === "55P03" || code === "57014") throw new ServiceError(503, "Resource is busy; retry shortly", 1);
  throw error;
}

/** Injection is for isolated PostgreSQL integration tests and separately pooled workers. */
export function createResourceGuards(database: Pick<typeof db, "transaction">) {
  async function consumeBudget(userId: string, kind: "request" | "write"): Promise<void> {
    requireOwner(userId);
    if (kind !== "request" && kind !== "write") throw new TypeError("Unknown budget kind");
    const window = sql.identifier(`${kind}_window`);
    const count = sql.identifier(`${kind}_count`);
    let charged: number;
    try {
      // This transaction commits BEFORE rate-limit errors or the note transaction.
      charged = await database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        const result = await tx.execute(sql`
          INSERT INTO resource_guards (user_id, ${window}, ${count})
          VALUES (${userId}, date_trunc('minute', clock_timestamp()), 1)
          ON CONFLICT (user_id) DO UPDATE SET
            (${count}, ${window}) = (
              SELECT CASE WHEN resource_guards.${window} = clock.window
                THEN resource_guards.${count} + 1 ELSE 1 END,
                clock.window
              FROM (SELECT date_trunc('minute', clock_timestamp()) AS window OFFSET 0) AS clock
            )
          RETURNING ${count} AS charged
        `);
        return Number(result.rows[0]!.charged);
      });
    } catch (error) { busyError(error); }
    const limit = kind === "request" ? RESOURCE_LIMITS.requestsPerMinute : RESOURCE_LIMITS.writesPerMinute;
    if (charged! > limit) throw new ServiceError(429, "Rate limit exceeded; retry in 60 seconds", 60);
  }

  async function withUserWrite<T>(userId: string, callback: (tx: NotesTransaction) => Promise<T>): Promise<T> {
    requireOwner(userId);
    await consumeBudget(userId, "write");
    try {
      return await database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        // Acquire BEFORE any note reads. READ COMMITTED makes the next statement
        // see the preceding lock holder's commit (including concurrent deletion).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'presenter-notes:user:' + userId}, 0))`);
        return callback(tx);
      }, { isolationLevel: "read committed" });
    } catch (error) { busyError(error); }
  }
  return { consumeBudget, withUserWrite };
}

export const { consumeBudget, withUserWrite } = createResourceGuards(db);

/** Must run inside withUserWrite after reading the old note under that lock. */
export async function checkNoteQuota(tx: NotesTransaction, userId: string, oldBytes: number, newBytes: number, inserting: boolean): Promise<void> {
  requireOwner(userId);
  if (![oldBytes, newBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError("Invalid note byte size");
  const result = await tx.execute(sql`
    SELECT count(*) AS note_count,
      coalesce(sum(octet_length(title)::bigint + octet_length(event)::bigint + octet_length(content)::bigint
        + coalesce(octet_length(event_date),0) + coalesce(octet_length(filename),0)
        + coalesce((SELECT sum(octet_length(tag)) FROM unnest(tags) AS tag),0)),0) AS text_bytes
    FROM notes WHERE user_id = ${userId}
  `);
  const usage = result.rows[0]!;
  if (inserting && Number(usage.note_count) >= RESOURCE_LIMITS.notes) throw new ServiceError(409, "Note count quota exceeded");
  // Existing over-quota owners can always make non-growing edits. Never delete,
  // truncate, or reject a reduction because of pre-existing excess usage.
  if ((inserting || newBytes > oldBytes) && Number(usage.text_bytes) - (inserting ? 0 : oldBytes) + newBytes > RESOURCE_LIMITS.noteBytes) {
    throw new ServiceError(409, "Note storage quota exceeded");
  }
}
