const STORAGE_ROOT = 'cosmos_memory';
const ITEM_STORAGE_PATH = `${STORAGE_ROOT}.items`;
const ITEM_PROMPT_ID = 'cosmos_memory_items';
const ITEM_PROMPT_DEPTH = 10000;

export type ItemOperationType = 'add' | 'set' | 'delete';

export type ItemOperation = {
  type: ItemOperationType;
  name: string;
  brief?: string;
};

export type StoredItem = {
  name: string;
  brief: string;
};

type SummaryWithItemOperations = {
  item_operations?: ItemOperation[];
};

export const ItemOperationResponse = z.object({
  type: z.enum(['add', 'set', 'delete']),
  name: z.string().trim().min(1),
  brief: z.string().trim().optional().default(''),
});

export const ItemOperationsResponse = z.array(ItemOperationResponse).default([]);

let item_prompt_injected = false;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeItemKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isStoredItem(value: unknown): value is StoredItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<StoredItem>).name === 'string' &&
    typeof (value as Partial<StoredItem>).brief === 'string'
  );
}

function getStoredItemRecord(): Record<string, StoredItem> {
  const variables = window.TavernHelper.getVariables({ type: 'chat' });
  const items = _.get(variables, ITEM_STORAGE_PATH, {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(items).filter((entry): entry is [string, StoredItem] => {
      const [key, item] = entry;
      return Boolean(key) && isStoredItem(item);
    }),
  );
}

export function getStoredItems(): StoredItem[] {
  return Object.values(getStoredItemRecord()).sort((left, right) => left.name.localeCompare(right.name));
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

export function applyItemOperations(operations: ItemOperation[]): StoredItem[] {
  const items = getStoredItemRecord();
  for (const operation of operations) {
    mergeItemOperation(items, operation);
  }

  saveItemRecord(items);
  return getStoredItems();
}

export function rebuildStoredItemsFromSummaries(summaries: SummaryWithItemOperations[]): StoredItem[] {
  const items: Record<string, StoredItem> = {};
  for (const summary of summaries) {
    for (const operation of summary.item_operations ?? []) {
      mergeItemOperation(items, operation);
    }
  }

  saveItemRecord(items);
  return Object.values(items).sort((left, right) => left.name.localeCompare(right.name));
}

function saveItemRecord(items: Record<string, StoredItem>) {
  window.TavernHelper.updateVariablesWith(
    variables => {
      _.set(variables, ITEM_STORAGE_PATH, items);
      return variables;
    },
    { type: 'chat' },
  );
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

function clearChatItemPrompt() {
  if (!item_prompt_injected) {
    return;
  }

  window.TavernHelper.uninjectPrompts([ITEM_PROMPT_ID]);
  item_prompt_injected = false;
}

export function applyItemPromptInjection(enabled: boolean): boolean {
  clearChatItemPrompt();

  if (!enabled) {
    return false;
  }

  const content = formatItemsForPrompt();
  if (!content) {
    return false;
  }

  window.TavernHelper.injectPrompts(
    [
      {
        id: ITEM_PROMPT_ID,
        position: 'in_chat',
        depth: ITEM_PROMPT_DEPTH,
        role: 'system',
        content,
      },
    ],
    { once: true },
  );
  item_prompt_injected = true;
  return true;
}
