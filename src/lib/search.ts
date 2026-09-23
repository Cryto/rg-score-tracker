// Apostrophe look-alikes used in titles and typed by keyboards: ASCII ',
// smart quotes ‘ ’ (phones insert these automatically), modifier letter ʼ,
// backtick and acute accent. NFKC doesn't unify them, and turns ´ into a space
// plus a combining accent, so they're dropped before and after normalizing.
const APOSTROPHES = /['‘’ʼ`´]/g;

/**
 * Text folded for substring search: width- and case-insensitive, with
 * apostrophes dropped so "youre", "you're" and "you’re" all match.
 * Apply it to both the searched text and the query.
 */
export function searchKey(s: string): string {
  return s.replace(APOSTROPHES, '').normalize('NFKC').replace(APOSTROPHES, '').toLowerCase();
}
