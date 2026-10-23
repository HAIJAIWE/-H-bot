// src/renderer/src/components/ai/clipboardImage.ts
//
// **把剪贴板里的图片变成能发给模型的 data URL**。
//
// ## 为什么必须先缩图（2026-10-09）
//
// 一张 4K 截图 base64 之后是 **十几 MB**：
//   · 走 IPC 慢、占内存；
//   · 很多厂商对单张图片有体积上限，超了直接 400；
//   · 视觉 token 跟分辨率走，4K 一张能吃掉几千 token。
//
// 口径：**小图原样保留（截图里的字要清晰），大图才压**。
// 截图大多是 UI 文字，盲目转 JPEG 会把小字压糊 —— 那是"能看图但看不清"，
// 比"看不了"更糟。

/** 一轮最多几张（与主进程 MAX_ROUND_IMAGES / schema 的上限一致） */
export const MAX_IMAGES = 4;

/** 超过这个体积才压（base64 长度；≈1.5MB 原始数据） */
const KEEP_AS_IS_MAX_CHARS = 2_000_000;

/** 压缩后最长边（业界常用的视觉模型输入上限附近） */
const MAX_SIDE = 1568;

/** 压缩后的 JPEG 质量 */
const JPEG_QUALITY = 0.85;

/** 读成 data URL */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    // 英文：本目录有「不许硬编码中文界面文案」的闸门，而这句是内部错误、不进界面
    reader.onerror = () => reject(reader.error ?? new Error('failed to read image'));
    reader.readAsDataURL(file);
  });
}

/** 缩到 MAX_SIDE 以内，返回 JPEG data URL */
async function downscale(dataUrl: string): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl; // 拿不到画布就别硬来，原图也比没有强
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

/**
 * 剪贴板里的一个图片文件 → 可发送的 data URL。
 *
 * 失败返回 null（**不抛**）：贴图失败不该把发送整个搞崩，调用方静默跳过即可。
 */
export async function clipboardImageToDataUrl(file: File): Promise<string | null> {
  try {
    const raw = await readAsDataUrl(file);
    if (!raw.startsWith('data:image/')) return null;
    // 小图原样保留：截图里的文字要清晰
    if (raw.length <= KEEP_AS_IS_MAX_CHARS) return raw;
    return await downscale(raw);
  } catch {
    return null;
  }
}

/** 从一次 paste 事件里取出所有图片（没有就返回空数组） */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}
