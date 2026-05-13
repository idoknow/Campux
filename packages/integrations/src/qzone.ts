export type QZonePublishInput = {
  tenantId: string;
  postId: string;
  targetId: string;
  targetName: string;
  text: string;
  renderedCard: Uint8Array;
  imageUrls: string[];
};

export type QZonePublishResult = {
  externalId: string;
  verbose: {
    mode: "mock-qzone";
    renderedBytes: number;
    imageCount: number;
    publishedAt: string;
  };
};

export async function publishToQZone(input: QZonePublishInput): Promise<QZonePublishResult> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${input.tenantId}:${input.postId}:${input.targetId}:${input.text}:${input.renderedCard.byteLength}`),
  );
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    externalId: `mock-qzone-${hash}`,
    verbose: {
      mode: "mock-qzone",
      renderedBytes: input.renderedCard.byteLength,
      imageCount: input.imageUrls.length,
      publishedAt: new Date().toISOString(),
    },
  };
}
