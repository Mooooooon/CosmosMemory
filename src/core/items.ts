import {
  defineEntityStore,
  normalizeEntityKey,
  normalizeText,
  STORAGE_ROOT,
  type EntityMeta,
} from '@/core/entity-store';

const ITEM_STORAGE_PATH = `${STORAGE_ROOT}.items`;
export const ITEM_PROMPT_ID = 'cosmos_memory_items';
export const ITEM_PROMPT_DEPTH = 10000;

export type ItemOperationType = 'add' | 'set' | 'delete';

export type ItemOperation = {
  type: ItemOperationType;
  name: string;
  brief?: string;
};

export type StoredItem = {
  name: string;
  brief: string;
  /** 最后影响该记录的摘要楼层；手动重建或旧版本数据为 undefined */
  source_message_id?: number;
  /** 最后影响该记录的摘要生成时间 */
  updated_at?: string;
};

type SummaryWithItemOperations = {
  message_id?: number;
  updated_at?: string;
  item_operations?: ItemOperation[];
};

export const ItemOperationResponse = z.object({
  type: z.enum(['add', 'set', 'delete']),
  name: z.string().trim().min(1),
  brief: z.string().trim().optional().default(''),
});

export const ItemOperationsResponse = z.array(ItemOperationResponse).default([]);

export function normalizeItemKey(name: string): string {
  return normalizeEntityKey(name);
}

function isStoredItem(value: unknown): value is StoredItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<StoredItem>).name === 'string' &&
    typeof (value as Partial<StoredItem>).brief === 'string'
  );
}

function mergeItemOperation(items: Record<string, StoredItem>, operation: ItemOperation): Record<string, StoredItem> {
  const name = normalizeText(operation.name);
  const key = normalizeItemKey(name);
  if (!key) {
    return items;
  }

  if (operation.type === 'delete') {
    _.unset(items, key);
    return items;
  }

  const existing = items[key];
  const brief = normalizeText(operation.brief);
  items[key] = {
    name: name || existing?.name || '',
    brief: brief || existing?.brief || '',
  };
  return items;
}

const itemStore = defineEntityStore<StoredItem, ItemOperation, SummaryWithItemOperations>({
  storagePath: ITEM_STORAGE_PATH,
  entityName: '物品',
  isValidEntity: isStoredItem,
  getEntityKey: item => normalizeItemKey(item.name),
  applyOperation: (record, operation) => {
    const key = normalizeItemKey(normalizeText(operation.name));
    mergeItemOperation(record, operation);
    return key ? [key] : [];
  },
  sortEntities: (left, right) => left.name.localeCompare(right.name),
  getSummaryOperations: summary => summary.item_operations,
  getSummaryMeta: summary => ({ source_message_id: summary.message_id, updated_at: summary.updated_at }),
});

export function getStoredItems(): StoredItem[] {
  return itemStore.getAll();
}

export function applyItemOperations(operations: ItemOperation[], meta: EntityMeta = {}): StoredItem[] {
  return itemStore.applyOperations(operations, meta);
}

export function rebuildStoredItemsFromSummaries(summaries: SummaryWithItemOperations[]): StoredItem[] {
  return itemStore.rebuildFromSummaries(summaries);
}

export function formatItemsForPrompt(items: StoredItem[] = getStoredItems()): string {
  if (items.length === 0) {
    return '';
  }

  const lines = ['[CosmosMemory 物品信息]', '以下是已经记录的重要道具、装备、礼物、信物等物品状态。'];
  for (const item of items) {
    lines.push(`- 物品名：${item.name}`);
    if (item.brief) {
      lines.push(`  简介：${item.brief}`);
    }
  }
  lines.push('[/CosmosMemory 物品信息]');
  return lines.join('\n');
}
