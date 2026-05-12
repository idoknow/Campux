export type RenderPostCardInput = {
  tenantName: string;
  authorName: string;
  text: string;
  createdAt: Date;
  anonymous: boolean;
};

export async function renderPostCard(_input: RenderPostCardInput): Promise<Uint8Array> {
  throw new Error("renderPostCard is not implemented yet");
}
