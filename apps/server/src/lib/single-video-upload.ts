import { Buffer } from "node:buffer";
import type { FastifyRequest } from "fastify";

const multipartLimitCodes = new Set([
  "FST_PARTS_LIMIT",
  "FST_FILES_LIMIT",
  "FST_FIELDS_LIMIT",
  "FST_REQ_FILE_TOO_LARGE",
]);

export class SingleVideoUploadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "SingleVideoUploadError";
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

export async function readSingleVideoUpload(
  request: FastifyRequest,
  {
    maxBytes,
    isAllowedMimeType,
    missingMessage,
    sizeMessage,
    shapeMessage,
    typeMessage,
  }: {
    maxBytes: number;
    isAllowedMimeType: (mimetype: string) => boolean;
    missingMessage: string;
    sizeMessage: string;
    shapeMessage: string;
    typeMessage: string;
  },
): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
  let upload: { buffer: Buffer; filename: string; mimetype: string } | null = null;

  try {
    for await (const part of request.parts({
      limits: {
        fieldNameSize: 64,
        fieldSize: 1,
        fields: 0,
        files: 1,
        headerPairs: 32,
        parts: 1,
        fileSize: maxBytes,
      },
    })) {
      if (part.type !== "file" || upload) {
        if (part.type === "file") {
          part.file.destroy();
        }
        throw new SingleVideoUploadError(413, shapeMessage);
      }
      if (!isAllowedMimeType(part.mimetype || "")) {
        part.file.destroy();
        throw new SingleVideoUploadError(415, typeMessage);
      }

      let transferredBytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        transferredBytes += buffer.byteLength;
        if (transferredBytes > maxBytes) {
          part.file.destroy();
          throw new SingleVideoUploadError(413, sizeMessage);
        }
        chunks.push(buffer);
      }
      if (part.file.truncated) {
        throw new SingleVideoUploadError(413, sizeMessage);
      }

      upload = {
        buffer: Buffer.concat(chunks, transferredBytes),
        filename: part.filename || "video.mp4",
        mimetype: part.mimetype || "application/octet-stream",
      };
    }
  } catch (error) {
    if (error instanceof SingleVideoUploadError) {
      throw error;
    }
    const code = errorCode(error);
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      throw new SingleVideoUploadError(413, sizeMessage);
    }
    if (multipartLimitCodes.has(code)) {
      throw new SingleVideoUploadError(413, shapeMessage);
    }
    throw error;
  }

  if (!upload) {
    throw new SingleVideoUploadError(400, missingMessage);
  }
  return upload;
}
