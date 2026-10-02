import { getStringHash } from '@sillytavern/scripts/utils';

const FloorBindingSchema = z.object({
  message_id: z.number().int().min(0),
  swipe_id: z.number().int().min(0),
  content_hash: z.number().int(),
});
export type FloorBinding = z.infer<typeof FloorBindingSchema>;
export type FloorEdit<T> = FloorBinding & { updated_at: string; value: T };
export const floor_history_revision = ref(0);
const history_pruners = new Map<string, (first_deleted_message_id?: number) => boolean>();

export function getFloorBinding(message_id = window.TavernHelper.getLastMessageId()): FloorBinding {
  if (message_id < 0) throw new Error(t`当前聊天没有可绑定的楼层。`);
  const message = window.TavernHelper.getChatMessages(message_id, { include_swipes: false })[0];
  if (!message) throw new Error(t`要绑定的楼层已不存在。`);
  const swiped = window.TavernHelper.getChatMessages(message_id, { include_swipes: true })[0];
  return { message_id, swipe_id: swiped?.swipe_id ?? 0, content_hash: getStringHash(message.message) };
}

export function isFloorBindingActive(
  binding: FloorBinding,
  max_message_id = window.TavernHelper.getLastMessageId(),
): boolean {
  if (binding.message_id > max_message_id) return false;
  try {
    const current = getFloorBinding(binding.message_id);
    return (
      current.message_id === binding.message_id &&
      current.swipe_id === binding.swipe_id &&
      current.content_hash === binding.content_hash
    );
  } catch {
    return false;
  }
}

function isFloorBindingStored(binding: FloorBinding): boolean {
  if (binding.message_id > window.TavernHelper.getLastMessageId()) return false;
  const message = window.TavernHelper.getChatMessages(binding.message_id, { include_swipes: true })[0];
  if (!message) return false;
  if ((message.swipe_id ?? 0) === binding.swipe_id) return isFloorBindingActive(binding);
  const content = message.swipes?.[binding.swipe_id];
  return content !== undefined ? getStringHash(content) === binding.content_hash : isFloorBindingActive(binding);
}

/** 所有类别共用同一种楼层日志；无楼层绑定的旧格式不参与重放。 */
export function defineFloorHistory<T>(storage_path: string, value_schema: z.ZodType<T>) {
  const entry_schema = FloorBindingSchema.extend({ updated_at: z.string(), value: value_schema });
  function read(): FloorEdit<T>[] {
    const raw = _.get(window.TavernHelper.getVariables({ type: 'chat' }), storage_path, []);
    if (!Array.isArray(raw)) throw new Error(t`楼层修改记录格式异常。`);
    return raw.flatMap(value => {
      const entry = entry_schema.safeParse(value);
      if (!entry.success) {
        console.warn('[CosmosMemory] 已忽略未绑定楼层或无效的修改记录', { path: storage_path });
        return [];
      }
      return [entry.data as FloorEdit<T>];
    });
  }
  function save(entries: FloorEdit<T>[]) {
    window.TavernHelper.updateVariablesWith(
      variables => {
        _.set(variables, storage_path, entries);
        return variables;
      },
      { type: 'chat' },
    );
    floor_history_revision.value++;
  }
  function append(value: T, binding = getFloorBinding()) {
    if (!isFloorBindingActive(binding)) throw new Error(t`绑定楼层或分支已变化，请重新执行修改。`);
    const entry = entry_schema.parse({ ...binding, updated_at: new Date().toISOString(), value });
    save([...read(), klona(entry as FloorEdit<T>)]);
  }
  function active(max_message_id = window.TavernHelper.getLastMessageId()): FloorEdit<T>[] {
    const bindings = new Map<number, FloorBinding | null>();
    return read()
      .filter(entry => {
        if (entry.message_id > max_message_id) return false;
        if (!bindings.has(entry.message_id)) {
          try {
            bindings.set(entry.message_id, getFloorBinding(entry.message_id));
          } catch {
            bindings.set(entry.message_id, null);
          }
        }
        return _.isEqual(bindings.get(entry.message_id), {
          message_id: entry.message_id,
          swipe_id: entry.swipe_id,
          content_hash: entry.content_hash,
        });
      })
      .sort((left, right) => left.message_id - right.message_id);
  }
  history_pruners.set(storage_path, first_deleted_message_id => {
    const entries = read();
    const next = entries.filter(
      entry =>
        (first_deleted_message_id === undefined || entry.message_id < first_deleted_message_id) &&
        isFloorBindingStored(entry),
    );
    if (entries.length === next.length) return false;
    save(next);
    return true;
  });
  return { read, append, active };
}

/** 摘要先于同楼层修改，之后的摘要自然接管此前状态；同楼层多次修改保持保存顺序。 */
export function replayFloorTimeline<TSummary, TEdit>(
  summaries: TSummary[],
  edits: FloorEdit<TEdit>[],
  summary_message_id: (summary: TSummary) => number,
  apply_summary: (summary: TSummary) => void,
  apply_edit: (edit: FloorEdit<TEdit>) => void,
  max_message_id = window.TavernHelper.getLastMessageId(),
) {
  const events = [
    ...summaries
      .filter(summary => summary_message_id(summary) <= max_message_id)
      .map(summary => ({ message_id: summary_message_id(summary), order: 0, run: () => apply_summary(summary) })),
    ...edits.map(edit => ({ message_id: edit.message_id, order: 1, run: () => apply_edit(edit) })),
  ].sort((left, right) => left.message_id - right.message_id || left.order - right.order);
  events.forEach(event => event.run());
}

/** 真正删除时清掉楼层日志；切换分支只停用，保留日志以便切回恢复。 */
export function reconcileFloorHistories(first_deleted_message_id?: number): boolean {
  let changed = false;
  for (const prune of history_pruners.values()) changed = prune(first_deleted_message_id) || changed;
  return changed;
}
