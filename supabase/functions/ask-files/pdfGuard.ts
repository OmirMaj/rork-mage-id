// ask-files/pdfGuard.ts: counting a PDF's pages without letting the PDF decide
// how much memory that takes.
//
// THE HOLE THIS CLOSES. pdf-lib's PDFDocument.load decodes every OBJECT STREAM
// and every CROSS-REFERENCE STREAM of the file while it parses, into a buffer
// that grows by doubling with no ceiling. A 49 KB PDF whose object stream
// inflates to 48 MB was opened and counted as one page (security check,
// 2026-10-04). The file size limits do not help: the size on the wire says
// nothing about the size after decoding.
//
// THE RULE. While a PDF is being counted, every byte pdf-lib's own decoders ask
// for is charged to one budget for that file (PDF_INFLATE_MAX_BYTES), across
// every stream and every filter of a chain, and the request that would pass it
// is refused BEFORE the buffer is allocated. The count is also raced against a
// short timer (PDF_COUNT_TIMEOUT_MS), and past the deadline any further
// decoding is refused too (a decode is synchronous, so a timer alone could not
// interrupt it). A file that trips either is "could not be read": the
// handler's ordinary unreadable_file refusal, before the allowance is read and
// before any model call, so it costs the user nothing.
//
// WHY INSIDE pdf-lib AND NOT A SCAN OF THE FILE FIRST. A scan has to decide
// which streams pdf-lib will decode, and has to agree with pdf-lib's parser on
// every spelling of that (a name written with #-escapes, a filter chain, LZW or
// run-length instead of Flate, a length that lies). Two parsers that can
// disagree are the hole. Here there is one: the ceiling sits on
// DecodeStream.prototype.ensureBuffer, the ONE place every pdf-lib decoder
// (Flate, LZW, ASCII85, ASCIIHex, RunLength) grows its output, so whatever
// pdf-lib decides to decode is what gets counted. A page's own content and
// image streams are never decoded by a page count, so a large scanned sheet is
// not refused.
//
// The version is pinned (pdf-lib 1.17.1 in index.ts). If the decoder's growth
// point cannot be found (a different pdf-lib), nothing is guarded, so NOTHING
// IS COUNTED: every PDF is refused as unreadable. scripts/
// validate-ask-files-server.ts runs this file against the real pdf-lib 1.17.1
// with bomb PDFs it builds in memory.
//
// Pure: no runtime global but timers and Date, no remote import. pdf-lib is
// handed in.

/** The most bytes pdf-lib may decode while one PDF is opened and counted. */
export const PDF_INFLATE_MAX_BYTES = 16777216;
/** How long one page count may take. */
export const PDF_COUNT_TIMEOUT_MS = 5000;

/** The four things of pdf-lib this file touches. */
export interface PdfLibLike {
  PDFDocument: { load(bytes: Uint8Array, options: { updateMetadata: boolean }): Promise<{ getPageCount(): number }> };
  PDFContext: { create(): { obj(literal: never): unknown } };
  PDFRawStream: { of(dict: never, contents: Uint8Array): unknown };
  decodePDFRawStream(stream: never): unknown;
}

interface Budget {
  /** Bytes still allowed. Below 0 = tripped. */
  left: number;
  /** Date.now() after which nothing more is decoded. */
  deadline: number;
  tripped: boolean;
  /** The most each decoder has asked for so far. */
  asked: WeakMap<object, number>;
  now: () => number;
}

/** The budget of the PDF being counted right now (one at a time, see the queue below). */
let active: Budget | null = null;

type EnsureBuffer = (this: object, requested: number) => unknown;
type Guardable = { ensureBuffer?: unknown; __mageidPdfInflateGuard?: true };

/**
 * Put the ceiling on pdf-lib's decoders. True when it is in place (now or from
 * an earlier call); false when the growth point was not found, and then the
 * caller must not count anything.
 */
export function installPdfInflateGuard(pdfLib: PdfLibLike): boolean {
  let proto: Guardable | null = null;
  try {
    // An empty zlib stream, only to get hold of a decoder and walk to the class
    // every decoder extends. Nothing is decoded here.
    const dict = pdfLib.PDFContext.create().obj({ Filter: 'FlateDecode' } as never);
    const raw = pdfLib.PDFRawStream.of(dict as never, new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]));
    let at: unknown = pdfLib.decodePDFRawStream(raw as never);
    while (at !== null && typeof at === 'object') {
      if (Object.prototype.hasOwnProperty.call(at, 'ensureBuffer')) { proto = at as Guardable; break; }
      at = Object.getPrototypeOf(at);
    }
  } catch {
    return false;
  }
  if (proto === null || typeof proto.ensureBuffer !== 'function') return false;
  if (proto.__mageidPdfInflateGuard === true) return true;
  const original = proto.ensureBuffer as EnsureBuffer;
  proto.ensureBuffer = function guardedEnsureBuffer(this: object, requested: number): unknown {
    const b = active;
    if (b !== null) {
      const before = b.asked.get(this) ?? 0;
      if (typeof requested === 'number' && requested > before) {
        b.left -= requested - before;
        b.asked.set(this, requested);
      }
      // Not a number is refused too (NaN compares false with everything).
      if (b.tripped || !(b.left >= 0) || !(requested >= 0) || b.now() > b.deadline) {
        b.tripped = true;
        throw new Error('pdf decode refused');
      }
    }
    return original.call(this, requested);
  };
  proto.__mageidPdfInflateGuard = true;
  return true;
}

export interface PdfCountOptions {
  maxInflateBytes?: number;
  timeoutMs?: number;
  /** For tests. */
  now?: () => number;
}

/**
 * The page counter the handler uses: pages in a PDF, or null when it will not
 * open (a password-protected PDF does not), when opening it would decode more
 * than the ceiling, or when the count does not finish in time.
 *
 * One PDF at a time: pdf-lib yields while it parses, and the budget belongs to
 * exactly one file, so a second count waits for the first to settle (also
 * when the first already answered null on the timer and is still unwinding).
 */
export function makePdfPageCounter(pdfLib: PdfLibLike, options: PdfCountOptions = {}): (bytes: Uint8Array) => Promise<number | null> {
  const guarded = installPdfInflateGuard(pdfLib);
  const maxInflate = options.maxInflateBytes ?? PDF_INFLATE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? PDF_COUNT_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  let tail: Promise<void> = Promise.resolve();

  return async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
    // No guard, no count: fail closed.
    if (!guarded) return null;
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    const budget: Budget = { left: maxInflate, deadline: now() + timeoutMs, tripped: false, asked: new WeakMap(), now };
    active = budget;
    const load = (async (): Promise<number | null> => {
      try {
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const pages = doc.getPageCount();
        // pdf-lib swallows an error inside one object and carries on, so the
        // budget is asked directly: a file that tripped it is never counted.
        if (budget.tripped) return null;
        return Number.isInteger(pages) && pages >= 1 ? pages : null;
      } catch {
        return null;
      } finally {
        if (active === budget) active = null;
        release();
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => { budget.tripped = true; resolve(null); }, timeoutMs);
    });
    try {
      return await Promise.race([load, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
