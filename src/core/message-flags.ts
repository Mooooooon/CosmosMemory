/**
 * 楼层级消息标记的公共谓词：
 * compression / character-regeneration / vector-recall 等模块共同引用，
 * 避免各处重复实现同一份 message.data 读取逻辑。
 */
import { STORAGE_ROOT } from '@/core/entity-store';

export const HIDDEN_BY_COMPRESSION_PATH = `${STORAGE_ROOT}.hidden_by_compression`;

/** 是否为插件自建楼层（如插件写入的总结楼层），此类楼层不参与总结与向量化 */
export function isCosmosMemoryMessage(message: ChatMessage): boolean {
  return _.get(message.data, `${STORAGE_ROOT}.kind`) === 'summary';
}

/** 是否由本插件的压缩功能隐藏（区别于用户手动隐藏，前者可自动恢复） */
export function isHiddenByCompression(message: ChatMessage): boolean {
  return _.get(message.data, HIDDEN_BY_COMPRESSION_PATH) === true;
}
