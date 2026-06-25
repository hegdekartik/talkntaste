import Busboy from 'busboy';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Parse a multipart/form-data request and write the uploaded file to /tmp.
 *
 * @param {import('http').IncomingMessage} req — The raw request object
 * @returns {Promise<{ filePath: string, originalName: string, mimeType: string }>}
 */
export function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    });

    let fileInfo = null;

    busboy.on('file', (_fieldName, fileStream, info) => {
      const { filename, mimeType } = info;
      const ext = path.extname(filename || 'audio.webm') || '.webm';
      const tmpPath = path.join('/tmp', `${randomUUID()}${ext}`);
      const writeStream = fs.createWriteStream(tmpPath);

      fileStream.pipe(writeStream);

      writeStream.on('close', () => {
        fileInfo = {
          filePath: tmpPath,
          originalName: filename || 'audio.webm',
          mimeType: mimeType || 'audio/webm',
        };
      });

      fileStream.on('limit', () => {
        fs.unlink(tmpPath, () => {});
        reject(new Error('Audio file is too large. Maximum size is 10MB.'));
      });
    });

    busboy.on('finish', () => {
      if (fileInfo) {
        resolve(fileInfo);
      } else {
        reject(new Error('No audio file provided'));
      }
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    req.pipe(busboy);
  });
}

/**
 * Remove a temp file (best-effort, no errors thrown).
 * @param {string|undefined} filePath
 */
export function cleanupFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, () => {});
  }
}
