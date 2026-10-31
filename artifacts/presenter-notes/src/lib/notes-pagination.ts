export const NOTES_PAGE_SIZE = 25;
export const MAX_NOTES_OFFSET = 100000;

/** A successful empty later page may follow a deletion; return to page one. */
export function getRecoveredNotesOffset(offset: number, noteCount: number): number {
  return offset > 0 && noteCount === 0 ? 0 : offset;
}
