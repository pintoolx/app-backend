import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

/**
 * Lightweight HTTP client for the MagicBlock PER (Private Ephemeral Rollups)
 * REST API. Endpoint comes from `MAGICBLOCK_PER_ENDPOINT`; an optional API
 * key is forwarded as an `Authorization: Bearer` header when set.
 *
 * The client is lazy-instantiated so the module factory can decide at
 * runtime whether to wire the real adapter or the noop fallback.
 */
@Injectable()
export class MagicBlockPerClientService {
  private readonly logger = new Logger(MagicBlockPerClientService.name);
  private http: AxiosInstance | null = null;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    const url = this.getEndpointUrl();
    return Boolean(url);
  }

  getEndpointUrl(): string | null {
    const url = this.configService.get<string>('MAGICBLOCK_PER_ENDPOINT');
    return url && url.trim().length > 0 ? url.trim() : null;
  }

  getApiKey(): string | null {
    const k = this.configService.get<string>('MAGICBLOCK_PER_API_KEY');
    return k && k.trim().length > 0 ? k.trim() : null;
  }

  getHttp(): AxiosInstance {
    if (this.http) return this.http;
    const url = this.getEndpointUrl();
    if (!url) {
      throw new BadRequestException('MAGICBLOCK_PER_ENDPOINT is not configured');
    }
    const apiKey = this.getApiKey();
    this.http = axios.create({
      baseURL: url,
      timeout: 15_000,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    return this.http;
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const client = this.getHttp();
    try {
      const res = await client.post<T>(path, body);
      return res.data;
    } catch (err) {
      this.logger.error(`PER POST ${path} failed: ${this.toErrorMessage(err)}`);
      throw this.toBadRequest(err);
    }
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const client = this.getHttp();
    try {
      const res = await client.get<T>(path, { params });
      return res.data;
    } catch (err) {
      this.logger.error(`PER GET ${path} failed: ${this.toErrorMessage(err)}`);
      throw this.toBadRequest(err);
    }
  }

  private toBadRequest(err: unknown): Error {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      const status = ax.response?.status;
      if (status && status >= 400 && status < 500) {
        return new BadRequestException(
          `MagicBlock PER rejected request: ${this.toErrorMessage(err)}`,
        );
      }
    }
    return err instanceof Error ? err : new Error(this.toErrorMessage(err));
  }

  private toErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      const data = ax.response?.data;
      if (typeof data === 'string') return data.slice(0, 240);
      if (data && typeof data === 'object') return JSON.stringify(data).slice(0, 240);
      return ax.message;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
