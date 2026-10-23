// src/main/services/safeStorage.ts
//
// 向后兼容入口：真正的实现在 `infra/safeStorage`（早于本文件的重构已把实现搬过去，
// services 根目录下留了这个门面给 project.ts / official.ts 用）。
export {
  isEncryptionAvailable,
  encryptSecret,
  decryptSecret,
  tryDecryptSecret,
} from './infra/safeStorage';
