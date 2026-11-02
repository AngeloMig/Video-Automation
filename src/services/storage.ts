import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "./types";

export function localStorageRoot() {
  // turbopackIgnore keeps Next from tracing the project, and any stored media, into server output.
  return resolve(/*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR ?? ".data/storage");
}

/** Resolves a key under the storage root and rejects anything that escapes it. */
export function localPathFor(key: string) {
  const root = localStorageRoot();
  const full = resolve(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ root, key));
  if (!full.startsWith(root + sep)) throw new Error("Invalid storage key");
  return full;
}

/** Local disk for development. The renderer and ffprobe read through the worker's asset server. */
export const localStorage: StorageProvider = {
  name: "local",
  async putFile(key, localPath) {
    const target = localPathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(localPath, target);
    return { sizeBytes: (await stat(target)).size };
  },
  async downloadTo(key, localPath) {
    await mkdir(dirname(localPath), { recursive: true });
    await pipeline(createReadStream(localPathFor(key)), createWriteStream(localPath));
  },
  async exists(key) {
    return access(localPathFor(key)).then(
      () => true,
      () => false,
    );
  },
  async remove(key) {
    await rm(localPathFor(key), { force: true });
  },
  async readUrl(key) {
    return `file://${localPathFor(key)}`;
  },
  async uploadTarget() {
    return null;
  },
};

function s3Config() {
  return {
    client: new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    }),
    bucket: process.env.S3_BUCKET ?? "",
  };
}

/** Cloudflare R2 or any other S3-compatible store. */
export const s3Storage: StorageProvider = {
  name: "s3",
  async putFile(key, localPath, contentType) {
    const { client, bucket } = s3Config();
    const { size } = await stat(localPath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
    return { sizeBytes: size };
  },
  async downloadTo(key, localPath) {
    const { client, bucket } = s3Config();
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await mkdir(dirname(localPath), { recursive: true });
    await pipeline(object.Body as Readable, createWriteStream(localPath));
  },
  async exists(key) {
    const { client, bucket } = s3Config();
    return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(
      () => true,
      () => false,
    );
  },
  async remove(key) {
    const { client, bucket } = s3Config();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
  async readUrl(key, expiresInSeconds = 3600) {
    const { client, bucket } = s3Config();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
  },
  async uploadTarget(key, contentType) {
    const { client, bucket } = s3Config();
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
      expiresIn: 3600,
    });
    return { url, method: "PUT", headers: { "Content-Type": contentType } };
  },
};
