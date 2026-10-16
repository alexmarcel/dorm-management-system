import { DEFAULT_PHOTO_POLICY, type PhotoPolicy } from "./limit-definitions";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { assert } from "./service";
import { runtimeStorage, type RuntimeStorage } from "./control";
const root = () => runtimeStorage().photos;
function client() {
  return new S3Client({
    region: process.env.S3_REGION || "ap-southeast-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
}
function file(key: string) {
  assert(/^[a-f0-9-]+\.webp$/.test(key), 400, "Invalid photo key.");
  return path.join(/* turbopackIgnore: true */ root(), key);
}
export async function validatePhoto(
  bytes: Buffer,
  policy: PhotoPolicy = DEFAULT_PHOTO_POLICY,
) {
  assert(
    bytes.length <= policy.maxBytes && bytes.length > 0,
    400,
    "Photo exceeds the configured size limit.",
  );
  const metadata = await sharp(bytes, { limitInputPixels: 2560000 }).metadata();
  assert(
    metadata.format === "webp" &&
      metadata.width &&
      metadata.height &&
      metadata.width <= policy.maxDimension &&
      metadata.height <= policy.maxDimension &&
      (metadata.pages || 1) === 1,
    400,
    "Upload a static WebP image within the configured dimensions.",
  );
  const cleaned = await sharp(bytes, { limitInputPixels: 2560000 })
    .rotate()
    .webp({ quality: 80 })
    .toBuffer();
  assert(
    cleaned.length <= policy.maxBytes,
    400,
    "Photo is too large after validation. Try a smaller image.",
  );
  return { bytes: cleaned, width: metadata.width, height: metadata.height };
}
export async function putPhoto(
  key: string,
  bytes: Buffer,
  storage: RuntimeStorage = runtimeStorage(),
) {
  file(key);
  if (process.env.S3_BUCKET)
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storage.prefix + key,
        Body: bytes,
        ContentType: "image/webp",
      }),
    );
  else {
    await mkdir(storage.photos, { recursive: true });
    await writeFile(path.join(storage.photos, key), bytes, { flag: "wx" });
  }
}
export async function readPhoto(
  key: string,
  storage: RuntimeStorage = runtimeStorage(),
) {
  file(key);
  if (process.env.S3_BUCKET) {
    const result = await client().send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storage.prefix + key,
      }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  }
  return readFile(/* turbopackIgnore: true */ path.join(storage.photos, key));
}
export async function deletePhoto(key: string) {
  file(key);
  if (process.env.S3_BUCKET)
    await client().send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: runtimeStorage().prefix + key,
      }),
    );
  else
    await unlink(file(key)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
}
