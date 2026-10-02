import { defineFloorHistory, getFloorBinding, replayFloorTimeline, type FloorBinding } from '@/core/floor-history';

/**
 * 通用实体数据层：characters / items / locations 共享的存储骨架。
 *
 * 职责：
 * - 聊天变量的读取、校验（脏数据打日志并忽略）与写回；
 * - 操作日志的增量应用与按摘要全量重放（rebuild）；
 * - 手动编辑按楼层与分支保存，和摘要按时间顺序重放；
 * - 为被操作触及的实体写入来源元数据（source_message_id / updated_at），
 *   供后续剧情检索、删除楼层级联失效和向量化召回使用。
 *
 * 各实体模块只需提供：存储路径、校验函数、合并语义（applyOperation）、
 * 排序、摘要操作提取方式。地点的五级层级结构通过自定义 applyOperation 特化。
 */

/** 所有剧情结构化数据在聊天变量中的根路径 */
export const STORAGE_ROOT = 'cosmos_memory';

/** 实体记录的来源元数据 */
export type EntityMeta = {
  /** 最后影响该记录的摘要楼层；手动重建或旧版本数据为 undefined */
  source_message_id?: number;
  /** 最后影响该记录的摘要生成时间（ISO 字符串） */
  updated_at?: string;
};

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 统一的实体键规范化：去除首尾空白、压缩连续空白、小写化 */
export function normalizeEntityKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type EntityStoreConfig<TEntity, TOperation, TSummary> = {
  /** 聊天变量中的存储路径，例如 `cosmos_memory.characters` */
  storagePath: string;
  /** 日志中展示的实体名称，例如 '人物' */
  entityName: string;
  operationSchema: z.ZodType<TOperation>;
  /** 校验存储恢复的单条实体是否结构完整 */
  isValidEntity: (value: unknown) => value is TEntity;
  /** 从实体本身计算存储键（用于整体替换） */
  getEntityKey: (entity: TEntity) => string;
  /**
   * 将一条操作合并进实体表（原地修改），返回被触及的实体键（用于写入元数据）。
   * delete 操作同样返回目标键，元数据步骤会自动跳过已不存在的记录。
   */
  applyOperation: (record: Record<string, TEntity>, operation: TOperation) => string[];
  /** 实体输出排序 */
  sortEntities: (left: TEntity, right: TEntity) => number;
  /** 从一条楼层摘要中提取该实体的操作列表 */
  getSummaryOperations: (summary: TSummary) => TOperation[] | undefined;
  /** 从一条楼层摘要中提取来源元数据 */
  getSummaryMeta: (summary: TSummary) => EntityMeta;
};

export function defineEntityStore<TEntity extends object, TOperation, TSummary>(
  config: EntityStoreConfig<TEntity, TOperation, TSummary>,
) {
  const edit_schema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('operations'), operations: z.array(config.operationSchema) }),
    z.object({ type: z.literal('replace'), entities: z.array(z.custom<TEntity>(config.isValidEntity)) }),
  ]);
  const history = defineFloorHistory(`${config.storagePath}_manual_ops`, edit_schema);

  function getStoredRecord(): Record<string, TEntity> {
    const variables = window.TavernHelper.getVariables({ type: 'chat' });
    const entities = _.get(variables, config.storagePath, {}) as Record<string, unknown>;
    if (!_.isPlainObject(entities)) {
      console.warn(`[CosmosMemory] 存储的${config.entityName}数据整体格式异常，已按空表处理`, {
        path: config.storagePath,
      });
      return {};
    }

    return Object.fromEntries(
      Object.entries(entities).filter((entry): entry is [string, TEntity] => {
        const [key, entity] = entry;
        const valid = Boolean(key) && config.isValidEntity(entity);
        if (!valid) {
          console.warn(`[CosmosMemory] 存储的${config.entityName}数据格式异常，已忽略该条记录`, { key });
        }
        return valid;
      }),
    );
  }

  function saveRecord(record: Record<string, TEntity>) {
    window.TavernHelper.updateVariablesWith(
      variables => {
        _.set(variables, config.storagePath, record);
        return variables;
      },
      { type: 'chat' },
    );
  }

  /** 为被操作触及的实体写入来源元数据；只写入有定义的字段，不覆盖已有值 */
  function applyMeta(record: Record<string, TEntity>, touched_keys: string[], meta: EntityMeta) {
    const patch: Record<string, unknown> = {};
    if (meta.source_message_id !== undefined) {
      patch.source_message_id = meta.source_message_id;
    }
    if (meta.updated_at !== undefined) {
      patch.updated_at = meta.updated_at;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }

    for (const key of touched_keys) {
      const entity = record[key];
      if (_.isPlainObject(entity)) {
        Object.assign(entity, patch);
      }
    }
  }

  function applyOperationsToRecord(record: Record<string, TEntity>, operations: TOperation[], meta: EntityMeta) {
    for (const operation of operations) {
      const touched_keys = config.applyOperation(record, operation);
      applyMeta(record, touched_keys, meta);
    }
  }

  function getAll(): TEntity[] {
    return Object.values(getStoredRecord()).sort(config.sortEntities);
  }

  /** 增量应用一组操作（新摘要产生时使用） */
  function applyOperations(operations: TOperation[], meta: EntityMeta = {}): TEntity[] {
    const record = getStoredRecord();
    applyOperationsToRecord(record, operations, meta);
    saveRecord(record);
    return Object.values(record).sort(config.sortEntities);
  }

  /** 按楼层重放摘要与当前分支上的手动修改。 */
  function buildRecordFromSummaries(summaries: TSummary[], max_message_id?: number): Record<string, TEntity> {
    let record: Record<string, TEntity> = {};
    replayFloorTimeline(
      summaries,
      history.active(max_message_id),
      summary => config.getSummaryMeta(summary).source_message_id ?? -1,
      summary =>
        applyOperationsToRecord(record, config.getSummaryOperations(summary) ?? [], config.getSummaryMeta(summary)),
      edit => {
        const meta = { source_message_id: edit.message_id, updated_at: edit.updated_at };
        if (edit.value.type === 'replace') {
          record = Object.fromEntries(edit.value.entities.map(entity => [config.getEntityKey(entity), klona(entity)]));
          applyMeta(record, Object.keys(record), meta);
        } else applyOperationsToRecord(record, edit.value.operations, meta);
      },
      max_message_id,
    );
    return record;
  }

  function getAtMessage(summaries: TSummary[], max_message_id: number): TEntity[] {
    return Object.values(buildRecordFromSummaries(summaries, max_message_id)).sort(config.sortEntities);
  }

  function rebuildFromSummaries(summaries: TSummary[], max_message_id?: number): TEntity[] {
    const record = buildRecordFromSummaries(summaries, max_message_id);
    saveRecord(record);
    return Object.values(record).sort(config.sortEntities);
  }

  /** 整体替换也作为当前楼层的修改，回溯时能恢复替换前的数据。 */
  function replaceAll(entities: TEntity[], meta: EntityMeta = {}, binding = getFloorBinding()): TEntity[] {
    const record: Record<string, TEntity> = {};
    for (const entity of entities) {
      const key = config.getEntityKey(entity);
      if (!key) {
        console.warn(`[CosmosMemory] 跳过无法计算存储键的${config.entityName}记录`, { entity });
        continue;
      }
      record[key] = entity;
    }

    applyMeta(record, Object.keys(record), { ...meta, source_message_id: binding.message_id });
    history.append({ type: 'replace', entities }, binding);
    saveRecord(record);
    return Object.values(record).sort(config.sortEntities);
  }

  /**
   * 应用一条用户手动编辑操作：立即生效并追加进手动操作日志，
   * 重建时仅在绑定楼层仍位于当前时间线且分支一致时重放。
   * 同一实体的多次编辑天然覆盖（后写胜出），无需去重。
   */
  function applyManualOperation(operation: TOperation, binding: FloorBinding = getFloorBinding()): TEntity[] {
    const record = getStoredRecord();
    applyOperationsToRecord(record, [operation], {
      source_message_id: binding.message_id,
      updated_at: new Date().toISOString(),
    });
    history.append({ type: 'operations', operations: [operation] }, binding);
    saveRecord(record);
    console.info(`[CosmosMemory] 已应用${config.entityName}手动编辑`, { operation });
    return Object.values(record).sort(config.sortEntities);
  }

  return { getAll, getAtMessage, applyOperations, rebuildFromSummaries, replaceAll, applyManualOperation };
}
