import { S3Client } from "@aws-sdk/client-s3";
import type { CampuxConfig } from "@campux/config";

export function createS3Client(config: CampuxConfig) {
  return new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
}
