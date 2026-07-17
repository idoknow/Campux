import { describe, expect, test } from "bun:test";
import type { PendingAttachment } from "@/types/app";
import { applyAttachmentUploadFailure } from "./attachment-upload-state";

function attachment(id: string, remote = false): PendingAttachment {
  return {
    id,
    file: new File([], `${id}.${remote ? "gif" : "png"}`, {
      type: remote ? "image/gif" : "image/png",
    }),
    blobUrl: `blob:${id}`,
    kind: "image",
    sortOrder: 0,
    progress: 50,
    status: "uploading",
    originalVideo: undefined,
    ...(remote ? {
      remoteGifUrl: `https://cloudflarecnimg.scdn.io/${id}.gif`,
      remoteGifProof: "proof",
    } : {}),
  };
}

describe("applyAttachmentUploadFailure", () => {
  test("maps a local file index within interleaved local and remote attachments", () => {
    const result = applyAttachmentUploadFailure([
      attachment("video-first", true),
      attachment("image-second"),
      attachment("video-third", true),
      attachment("image-fourth"),
    ], 0, undefined, "image failed");

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "video-first", status: "ready" },
      { id: "image-second", status: "failed" },
      { id: "video-third", status: "ready" },
      { id: "image-fourth", status: "ready" },
    ]);
  });

  test("marks every invalid remote claim by its remote-only index", () => {
    const result = applyAttachmentUploadFailure([
      attachment("image-first"),
      attachment("video-second", true),
      attachment("image-third"),
      attachment("video-fourth", true),
    ], undefined, [0, 1], "claim expired");

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "image-first", status: "ready" },
      { id: "video-second", status: "failed" },
      { id: "image-third", status: "ready" },
      { id: "video-fourth", status: "failed" },
    ]);
  });

  test("returns uploading attachments to ready when the server restored consumed claims", () => {
    const result = applyAttachmentUploadFailure([
      attachment("image-first"),
      attachment("video-second", true),
    ], undefined, undefined, "temporary upstream error");

    expect(result.map(({ id, status, progress }) => ({ id, status, progress }))).toEqual([
      { id: "image-first", status: "ready", progress: 0 },
      { id: "video-second", status: "ready", progress: 0 },
    ]);
  });
});
