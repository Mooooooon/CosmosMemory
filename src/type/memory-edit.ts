import { CharacterOperationResponse } from '@/core/characters';
import { ItemOperationResponse } from '@/core/items';
import { LocationOperationResponse } from '@/core/locations';
import { SettingChangeOperationResponse } from '@/core/setting-changes';
import { MemoryInstructions } from '@/core/memory-instructions';

export const MemoryEditResponse = z
  .object({
    explanation: z.string().trim().min(1),
    character_operations: z.array(CharacterOperationResponse.strict()),
    item_operations: z.array(ItemOperationResponse.strict()),
    location_operations: z.array(LocationOperationResponse.strict()),
    setting_change_operations: z.array(SettingChangeOperationResponse.strict()),
    // 完整快照允许明确清空字段；null 表示不修改当前信息。
    current_info: z
      .object({
        current_time: z.string().trim(),
        location: z.string().trim(),
        characters: z.record(
          z.string().trim().min(1),
          z.object({ clothing: z.string().trim(), status: z.string().trim() }).strict(),
        ),
      })
      .strict()
      .nullable(),
    instructions: MemoryInstructions.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    result.setting_change_operations.forEach((operation, index) => {
      if (operation.type !== 'delete' && !operation.content) {
        context.addIssue({
          code: 'custom',
          message: '设定变更内容不能为空',
          path: ['setting_change_operations', index, 'content'],
        });
      }
    });
    const keys = result.instructions?.map(instruction => instruction.key.toLowerCase()) ?? [];
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: '记忆整理规则的 key 不能重复', path: ['instructions'] });
    }
  });

export type MemoryEditResult = z.infer<typeof MemoryEditResponse>;
