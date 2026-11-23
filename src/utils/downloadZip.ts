export async function triggerProjectZipDownload(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/project/download-zip', {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      return { ok: false, error: `تعذر تنزيل الملف (${res.status})` };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'HAMILHA_ANDROID_IOS.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true };
  } catch {
    return { ok: false, error: 'تعذر تنزيل الأرشيف المضغوط.' };
  }
}
