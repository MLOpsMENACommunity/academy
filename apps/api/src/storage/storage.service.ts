import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Signed URLs for payment screenshots, CVs and submitted files expire within 5 minutes. */
export const SIGNED_URL_TTL_SECONDS = 300;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * Private object storage (Cloudflare R2 in production, MinIO locally). The bucket is never
 * public; keys are random and never contain personal data. Images under media/ (course and
 * session covers, speaker photos) are served to everyone by the API (media/media.controller.ts).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  /** Same bucket, but addressed by a host the browser can reach (differs only in Docker). */
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.bucket = env.S3_BUCKET;
    const client = (endpoint: string | undefined) =>
      new S3Client({
        region: env.S3_REGION,
        endpoint,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      });
    this.s3 = client(env.S3_ENDPOINT);
    this.signer = env.S3_PUBLIC_ENDPOINT ? client(env.S3_PUBLIC_ENDPOINT) : this.s3;
  }

  async onModuleInit(): Promise<void> {
    if (!this.env.S3_CREATE_BUCKET) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        this.logger.warn(`Could not create bucket ${this.bucket}: ${(err as Error).message}`);
      }
    }
  }

  /** Stores a file under `<prefix>/<random>.<ext>` and returns the key. */
  async put(prefix: 'payments' | 'cvs' | 'submissions' | 'certificates' | 'media', body: Buffer, contentType: string): Promise<string> {
    const key = `${prefix}/${randomUUID()}.${EXT[contentType] ?? 'bin'}`;
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  /** Short-lived URL for admins to view a private file inline. */
  async signedUrl(key: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: 'inline' }),
      { expiresIn: Math.min(ttlSeconds, SIGNED_URL_TTL_SECONDS) },
    );
  }

  /** The object's bytes, or null when it doesn't exist (e.g. a cached certificate PDF was removed). */
  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
