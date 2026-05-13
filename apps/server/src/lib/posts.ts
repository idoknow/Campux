export function toPostListItem(post: {
  id: string;
  displayId: number;
  text: string;
  images: unknown;
  anonymous: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: post.id,
    displayId: post.displayId,
    title: post.text.length > 28 ? `${post.text.slice(0, 28)}...` : post.text,
    text: post.text,
    images: post.images,
    anonymous: post.anonymous,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
