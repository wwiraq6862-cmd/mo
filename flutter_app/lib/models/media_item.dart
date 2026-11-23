class QualityOption {
  final String id;
  final String label;
  final String resolution;
  final String format;
  final String sizeEstimate;
  final String mediaType;
  final String streamUrl;
  final String mimeType;

  QualityOption({
    required this.id,
    required this.label,
    required this.resolution,
    required this.format,
    required this.sizeEstimate,
    required this.mediaType,
    required this.streamUrl,
    required this.mimeType,
  });

  factory QualityOption.fromJson(Map<String, dynamic> json) {
    return QualityOption(
      id: json['id'] as String? ?? 'original',
      label: json['label'] as String? ?? 'الملف الأصلي',
      resolution: json['resolution'] as String? ?? '',
      format: json['format'] as String? ?? 'mp4',
      sizeEstimate: json['sizeEstimate'] as String? ?? 'غير محدد من المصدر',
      mediaType: json['mediaType'] as String? ?? 'video',
      streamUrl: json['streamUrl'] as String? ?? '',
      mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
    );
  }
}

class AnalyzedMedia {
  final String analysisId;
  final String url;
  final String platform;
  final String platformNameAr;
  final String title;
  final String author;
  final String? duration;
  final String? thumbnailUrl;
  final String mediaType;
  final bool downloadAllowed;
  final String policyNote;
  final String streamMode;
  final List<QualityOption> qualities;

  AnalyzedMedia({
    required this.analysisId,
    required this.url,
    required this.platform,
    required this.platformNameAr,
    required this.title,
    required this.author,
    required this.duration,
    required this.thumbnailUrl,
    required this.mediaType,
    required this.downloadAllowed,
    required this.policyNote,
    required this.streamMode,
    required this.qualities,
  });

  factory AnalyzedMedia.fromJson(Map<String, dynamic> json) {
    final list = (json['qualities'] as List<dynamic>? ?? [])
        .map((e) => QualityOption.fromJson(e as Map<String, dynamic>))
        .toList();
    return AnalyzedMedia(
      analysisId: json['analysisId'] as String? ?? '',
      url: json['url'] as String? ?? '',
      platform: json['platform'] as String? ?? 'direct',
      platformNameAr: json['platformNameAr'] as String? ?? '',
      title: json['title'] as String? ?? '',
      author: json['author'] as String? ?? '',
      duration: json['duration'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      mediaType: json['mediaType'] as String? ?? 'video',
      downloadAllowed: json['downloadAllowed'] as bool? ?? false,
      policyNote: json['policyNote'] as String? ?? '',
      streamMode: json['streamMode'] as String? ?? 'unavailable',
      qualities: list,
    );
  }
}

class DownloadRecord {
  final String id;
  final String url;
  final String platform;
  final String title;
  final String author;
  final String mediaType;
  final String quality;
  final String fileSize;
  final String source;
  final String createdAt;

  DownloadRecord({
    required this.id,
    required this.url,
    required this.platform,
    required this.title,
    required this.author,
    required this.mediaType,
    required this.quality,
    required this.fileSize,
    required this.source,
    required this.createdAt,
  });

  factory DownloadRecord.fromJson(Map<String, dynamic> json) {
    return DownloadRecord(
      id: json['id'] as String? ?? '',
      url: json['url'] as String? ?? '',
      platform: json['platform'] as String? ?? 'direct',
      title: json['title'] as String? ?? '',
      author: json['author'] as String? ?? '',
      mediaType: json['media_type'] as String? ?? 'video',
      quality: json['quality'] as String? ?? 'original',
      fileSize: json['file_size'] as String? ?? '',
      source: json['source'] as String? ?? 'flutter',
      createdAt: json['created_at'] as String? ?? '',
    );
  }
}
