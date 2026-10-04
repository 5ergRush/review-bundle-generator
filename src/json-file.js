import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ReviewerError } from './reviewer.js';

// Explicit offline CLI inputs only; nonblocking open avoids hanging on a FIFO.
export async function readJsonFile(path, maxBytes = 64 * 1024 * 1024) {
  let file;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new ReviewerError('INVALID_INPUT', 'JSON byte budget must be an integer from 1 to 67108864.');
    if (typeof path !== 'string' || !path) throw new ReviewerError('INVALID_INPUT', 'A JSON file path is required.');
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) throw new ReviewerError('INVALID_INPUT', 'JSON input must be a regular file.');
    if (stat.size > maxBytes) throw new ReviewerError('REVIEW_LIMIT', 'JSON file exceeds byte budget.');
    const buffer = Buffer.alloc(maxBytes + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break; total += bytesRead;
    }
    if (total > maxBytes) throw new ReviewerError('REVIEW_LIMIT', 'JSON file exceeds byte budget.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)));
  } catch (error) {
    if (error instanceof ReviewerError) throw error;
    throw new ReviewerError('INVALID_INPUT', 'Could not read valid UTF-8 JSON from the supplied file.');
  } finally { await file?.close(); }
}
