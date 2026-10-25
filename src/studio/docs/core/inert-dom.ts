// A detached <div> for parsing HTML strings. It belongs to an inert document (createHTMLDocument), so
// <img> / <video> / <audio> inside it never start loading — converting editor HTML must not fetch anything.
// Falls back to the page document where createHTMLDocument is unavailable (e.g. minimal test DOMs).
export function inertContainer(): HTMLDivElement {
  const doc = typeof document !== 'undefined' && document.implementation && typeof document.implementation.createHTMLDocument === 'function'
    ? document.implementation.createHTMLDocument('')
    : document
  return doc.createElement('div')
}
