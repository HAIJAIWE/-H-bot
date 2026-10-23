// src/main/services/infra/safeStorage.ts
import { safeStorage } from 'electron';

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptSecret(plain: string): string {
  if (!isEncryptionAvailable()) {
    throw new Error('系统不支持安全存储，无法加密凭证');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

export function decryptSecret(encryptedBase64: string): string {
  if (!isEncryptionAvailable()) {
    throw new Error('系统不支持安全存储，无法解密凭证');
  }
  const buf = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(buf);
}

export function tryDecryptSecret(encryptedBase64: string): string {
  try {
    return decryptSecret(encryptedBase64);
  } catch {
    return '';
  }
}
