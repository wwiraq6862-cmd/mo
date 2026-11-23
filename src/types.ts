export type PlatformId =
  | 'tiktok'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'whatsapp'
  | 'direct';

export type AppTab =
  | 'home'
  | 'downloads'
  | 'whatsapp'
  | 'flutter'
  | 'settings'
  | 'admin';

export interface QualityOption {
  id: string;
  label: string;
  resolution: string;
  format: 'mp4' | 'webm' | 'm4a' | 'mp3' | 'jpg' | 'png' | 'webp' | 'pdf';
  sizeEstimate: string;
  fileBytes: number | null;
  mediaType: 'video' | 'audio' | 'image' | 'document';
  streamUrl: string;
  mimeType: string;
}

export interface AnalyzedMedia {
  analysisId: string;
  url: string;
  platform: PlatformId;
  platformNameAr: string;
  title: string;
  author: string;
  duration: string | null;
  thumbnailUrl: string | null;
  mediaType: 'video' | 'image' | 'audio' | 'document';
  downloadAllowed: boolean;
  policyNote: string;
  streamMode: 'direct' | 'unavailable';
  qualities: QualityOption[];
}

export interface DownloadRecord {
  id: string;
  url: string;
  platform: string;
  title: string;
  author: string;
  thumbnail_url: string | null;
  media_type: string;
  quality: string;
  file_size: string;
  source: string;
  client_id: string;
  status: string;
  stream_mode: string;
  created_at: string;
}

export interface WhatsAppMessage {
  id: string;
  wa_message_id: string | null;
  sender_phone_masked: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string;
  media_url: string | null;
  platform: string | null;
  download_id: string | null;
  status: string;
  created_at: string;
}

export interface AppSettings {
  defaultQuality: '1080p' | '720p' | '480p';
  autoPasteOnFocus: boolean;
  confirmBeforeClear: boolean;
  showPlatformHints: boolean;
}
