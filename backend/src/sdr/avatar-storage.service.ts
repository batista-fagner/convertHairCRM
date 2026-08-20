import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// URLs de foto de perfil do WhatsApp (pps.whatsapp.net) são assinadas com
// expiração (parâmetro `oe`) e param de quebrar depois de alguns dias — por
// isso baixamos a imagem uma vez e guardamos no nosso próprio storage
// (Supabase), que não expira.
@Injectable()
export class AvatarStorageService {
  private readonly logger = new Logger(AvatarStorageService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      config.get('SUPABASE_URL') ?? '',
      config.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    this.bucket = config.get('SDR_AVATAR_BUCKET') ?? 'lead-avatars';
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const { data } = await this.supabase.storage.getBucket(this.bucket);
    if (!data) {
      const { error } = await this.supabase.storage.createBucket(this.bucket, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      });
      if (error && !/already exists/i.test(error.message)) {
        this.logger.error(`Erro ao criar bucket ${this.bucket}: ${error.message}`);
        return;
      }
    }
    this.bucketReady = true;
  }

  /**
   * Baixa a foto da URL temporária do WhatsApp e sobe pro Supabase Storage,
   * retornando a URL pública permanente. Se algo falhar, retorna a URL
   * original recebida (degrada graciosamente em vez de perder a foto).
   */
  async persistFromUrl(leadId: string, sourceUrl: string): Promise<string> {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`download falhou: HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const buffer = Buffer.from(await res.arrayBuffer());

      await this.ensureBucket();
      const storagePath = `${leadId}.${ext}`;
      const { error } = await this.supabase.storage
        .from(this.bucket)
        .upload(storagePath, buffer, { contentType, upsert: true });
      if (error) throw new Error(error.message);

      const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(storagePath);
      // Cache-bust: a URL pública é sempre a mesma pro mesmo lead (upsert), então
      // sem isso o browser pode continuar servindo a foto antiga do cache.
      return `${data.publicUrl}?v=${Date.now()}`;
    } catch (err: any) {
      this.logger.warn(`[Avatar] Falha ao persistir foto do lead ${leadId} no storage, usando URL original: ${err.message}`);
      return sourceUrl;
    }
  }
}
