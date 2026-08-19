/**
 * Base class for DTOs — thin wrappers around a single DB row that own the
 * queries for their table, so route files call methods (`ServiceDTO.get`,
 * `svc.update(...)`) instead of writing raw Drizzle queries inline.
 *
 * DTO instances are server-only. A `load`/action must call `.toJSON()`
 * (or map over a list) before returning data to the client — SvelteKit
 * serializes `load` return values with devalue, which doesn't know how to
 * serialize a class instance, only the plain row underneath it.
 */
export abstract class BaseDTO<TRow> {
  protected readonly row: TRow;

  protected constructor(row: TRow) {
    this.row = row;
  }

  /** The raw underlying row, for handing to a `load`/action return value. */
  toJSON(): TRow {
    return this.row;
  }
}
