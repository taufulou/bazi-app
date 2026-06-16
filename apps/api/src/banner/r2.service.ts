/**
 * R2Service — thin Cloudflare R2 (S3-compatible) wrapper for banner image
 * uploads. See plan `.claude/plans/1-how-the-image-mutable-anchor.md`.
 *
 * Design notes:
 * - The `S3Client` is constructed LAZILY (first upload/delete), not in the
 *   constructor, so jest + `nest build` boot cleanly without R2 env set.
 * - `requestChecksumCalculation: 'WHEN_REQUIRED'` — newer @aws-sdk/client-s3
 *   defaults add CRC integrity-checksum headers that R2 has historically
 *   rejected. The pinned aws-sdk version is the PRIMARY defense; this flag is
 *   belt-and-suspenders. (Valid key on @aws-sdk/client-s3 ≥ v3.729.)
 * - `deleteImage` is best-effort and NEVER throws (orphan cleanup, not
 *   correctness — a slide delete/replace must not be blocked by an R2 hiccup).
 */
import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  /** True when all R2 env vars are present (upload endpoint can run). */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('R2_ACCOUNT_ID') &&
        this.config.get<string>('R2_ACCESS_KEY_ID') &&
        this.config.get<string>('R2_SECRET_ACCESS_KEY') &&
        this.config.get<string>('R2_BUCKET') &&
        this.config.get<string>('R2_PUBLIC_BASE_URL'),
    );
  }

  /**
   * Upload an image buffer to R2. `ext` and `contentType` are derived from a
   * server-side magic-byte sniff (NOT the client mimetype). Returns the public
   * URL. Throws if R2 is not configured.
   */
  async uploadImage(
    buffer: Buffer,
    ext: string,
    contentType: string,
  ): Promise<string> {
    const key = `banners/${randomUUID()}.${ext}`;
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBase()}/${key}`;
  }

  /**
   * Best-effort delete by public URL — NEVER throws. Only deletes keys under
   * our own `banners/` prefix that match the configured public base, so a
   * stale or externally-hosted URL is silently skipped.
   */
  async deleteImage(url: string | null | undefined): Promise<void> {
    if (!url) return;
    try {
      const base = this.publicBase();
      const prefix = `${base}/`;
      if (!url.startsWith(prefix)) return; // not an R2-managed URL — skip
      const key = url.slice(prefix.length);
      if (!key.startsWith('banners/')) return; // defensive — only our prefix
      await this.getClient().send(
        new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
    } catch (err) {
      this.logger.warn(
        `R2 deleteImage failed for ${url}: ${(err as Error).message}`,
      );
    }
  }

  // ============================================================
  // Internals
  // ============================================================

  private getClient(): S3Client {
    if (this.client) return this.client;

    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new InternalServerErrorException(
        'R2 storage is not configured (set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).',
      );
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    return this.client;
  }

  private bucket(): string {
    const b = this.config.get<string>('R2_BUCKET');
    if (!b) {
      throw new InternalServerErrorException('R2_BUCKET is not set.');
    }
    return b;
  }

  private publicBase(): string {
    const base = this.config.get<string>('R2_PUBLIC_BASE_URL');
    if (!base) {
      throw new InternalServerErrorException('R2_PUBLIC_BASE_URL is not set.');
    }
    return base.replace(/\/+$/, ''); // strip trailing slash(es)
  }
}
