import {
  FileText,
  Film,
  Image as ImageIcon,
  MessageCircle,
  Music,
  PlaySquare,
  Share2,
} from 'lucide-react';

export function getPlatformLabelAr(platform: string): string {
  switch (platform) {
    case 'tiktok':
      return 'تيك توك';
    case 'facebook':
      return 'فيسبوك';
    case 'instagram':
      return 'إنستغرام';
    case 'youtube':
      return 'يوتيوب';
    case 'whatsapp':
      return 'واتساب';
    default:
      return 'وسائط مباشرة';
  }
}

export function detectClientPlatform(url: string): string | null {
  const lower = url.toLowerCase();
  if (!lower.startsWith('http')) return null;
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('whatsapp.com') || lower.includes('wa.me')) return 'whatsapp';
  if (/\.(mp4|mov|webm|jpg|jpeg|png|webp|mp3|m4a|pdf)(\?|$)/i.test(lower)) return 'direct';
  return null;
}

export function PlatformIcon({
  platform,
  className = 'w-5 h-5',
}: {
  platform: string;
  className?: string;
}) {
  switch (platform) {
    case 'tiktok':
      return <Music className={className} />;
    case 'youtube':
      return <PlaySquare className={className} />;
    case 'instagram':
      return <ImageIcon className={className} />;
    case 'facebook':
      return <Share2 className={className} />;
    case 'whatsapp':
      return <MessageCircle className={className} />;
    case 'document':
      return <FileText className={className} />;
    default:
      return <Film className={className} />;
  }
}
