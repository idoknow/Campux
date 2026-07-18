import { describe, expect, test } from "bun:test";
import type { PendingAttachment } from "@/types/app";
import {
  applyAttachmentUploadFailure,
  canAcceptAttachmentSelection,
  cleanupAttachmentLifecycle,
  markAttachmentsUploading,
  removeAttachmentsById,
  runWhenSubmissionIdle,
} from "./attachment-upload-state";

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

  test("returns uploading attachments to ready after a transient submission failure", () => {
    const result = applyAttachmentUploadFailure([
      attachment("image-first"),
      attachment("video-second", true),
    ], undefined, undefined, "temporary upstream error");

    expect(result.map(({ id, status, progress }) => ({ id, status, progress }))).toEqual([
      { id: "image-first", status: "ready", progress: 0 },
      { id: "video-second", status: "ready", progress: 0 },
    ]);
  });

  test("maps failure indexes against the immutable submission snapshot", () => {
    const submitted = [attachment("submitted-local"), attachment("submitted-remote", true)];
    const late = { ...attachment("late-local"), status: "ready" as const };
    const result = applyAttachmentUploadFailure(
      [late, ...submitted],
      0,
      undefined,
      "submitted image failed",
      submitted,
    );

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "late-local", status: "ready" },
      { id: "submitted-local", status: "failed" },
      { id: "submitted-remote", status: "ready" },
    ]);
  });
});

describe("submission attachment isolation", () => {
  test("rejects attachment input while a submission is busy", () => {
    expect(canAcceptAttachmentSelection(true, 1)).toBe(false);
    expect(canAcceptAttachmentSelection(false, 0)).toBe(false);
    expect(canAcceptAttachmentSelection(false, 1)).toBe(true);
  });

  test("drops stale mutation callbacks while a submission is busy", () => {
    const values: string[] = [];

    expect(runWhenSubmissionIdle(true, () => values.push("stale"))).toBe(false);
    expect(runWhenSubmissionIdle(false, () => values.push("accepted"))).toBe(true);
    expect(values).toEqual(["accepted"]);
  });

  test("removes only attachments captured in the successful submission snapshot", () => {
    const result = removeAttachmentsById([
      attachment("submitted-image"),
      attachment("late-paste"),
    ], new Set(["submitted-image"]));

    expect(result.map(({ id }) => id)).toEqual(["late-paste"]);
  });

  test("marks only snapshot attachments as uploading", () => {
    const submitted = { ...attachment("submitted-image"), status: "ready" as const };
    const late = { ...attachment("late-image"), status: "ready" as const };
    const result = markAttachmentsUploading(
      [submitted, late],
      new Set([submitted.id]),
    );

    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "submitted-image", status: "uploading" },
      { id: "late-image", status: "ready" },
    ]);
  });

  test("selective cleanup preserves later active conversion, queue entry, and blob URL", () => {
    const aborted: string[] = [];
    const revoked: string[] = [];
    const activeConversion = {
      attachmentId: "late-active",
      controller: { abort: () => aborted.push("late-active") },
    };
    const submittedQueued = {
      attachmentId: "submitted-queued",
      file: new File([], "submitted.mp4"),
    };
    const lateQueued = {
      attachmentId: "late-queued",
      file: new File([], "late.mp4"),
    };
    const ownedBlobUrls = new Map([
      ["submitted-queued", "blob:submitted"],
      ["late-active", "blob:late-active"],
      ["late-queued", "blob:late-queued"],
    ]);

    const result = cleanupAttachmentLifecycle({
      activeConversion,
      conversionQueue: [submittedQueued, lateQueued],
      ownedBlobUrls,
      attachmentIds: new Set(["submitted-queued"]),
      revokeObjectUrl: (url) => revoked.push(url),
    });

    expect(result.activeConversion).toBe(activeConversion);
    expect(result.conversionQueue.map(({ attachmentId }) => attachmentId)).toEqual(["late-queued"]);
    expect([...ownedBlobUrls.entries()]).toEqual([
      ["late-active", "blob:late-active"],
      ["late-queued", "blob:late-queued"],
    ]);
    expect(aborted).toEqual([]);
    expect(revoked).toEqual(["blob:submitted"]);
  });
});
