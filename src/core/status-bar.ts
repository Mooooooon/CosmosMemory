import { event_types, eventSource } from '@sillytavern/script';
import { getStoredCurrentInfo } from '@/core/current-info';
import { getStoredCharacters } from '@/core/characters';
import { getStoredItems } from '@/core/items';
import { getStoredLocations } from '@/core/locations';
import { useSettingsStore } from '@/store/settings';

let activeTab: 'current' | 'characters' | 'items' | 'locations' = 'current';
let updateTimeout: any = null;

/**
 * 获取最新未隐藏的 AI（assistant）回复楼层号
 */
function getLatestAiMessageId(): number | null {
  try {
    if (!window.TavernHelper) {
      return null;
    }
    const last_message_id = window.TavernHelper.getLastMessageId();
    if (last_message_id === null) return null;

    const messages = window.TavernHelper.getChatMessages('0-{{lastMessageId}}', { include_swipes: false });
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant' && !msg.is_hidden) {
        return msg.message_id;
      }
    }
  } catch (error) {
    console.error('[CosmosMemory] 获取最新 AI 回复楼层失败', error);
  }
  return null;
}

/**
 * 构建「标签：值」形式的行元素。
 * 值一律通过 .text() 写入，避免 AI 生成内容携带 HTML 破坏 DOM 或执行脚本。
 */
function makeLabeledLine(class_name: string, label: string, value: string): JQuery<HTMLElement> {
  return $(`<div class="${class_name}">`).append($('<strong>').text(label)).append($('<span>').text(value));
}

/**
 * 渲染指定 Tab 的内容
 */
function renderTabContent($container: JQuery<HTMLElement>) {
  $container.empty();

  try {
    switch (activeTab) {
      case 'current': {
        const info = getStoredCurrentInfo();
        if (!info.current_time && !info.location && Object.keys(info.characters).length === 0) {
          $container.append($('<div class="cosmos-empty">').text(t`尚未记录`));
          break;
        }

        const $list = $('<div class="cosmos-info-list">');
        $list.append(makeLabeledLine('cosmos-info-item', `${t`当前时间`}：`, info.current_time || t`尚未记录`));
        $list.append(makeLabeledLine('cosmos-info-item', `${t`当前地点`}：`, info.location || t`尚未记录`));

        const charEntries = Object.entries(info.characters);
        if (charEntries.length > 0) {
          $list.append($('<div class="cosmos-info-sub-title">').text(t`当前角色列表`));
          const $chars = $('<div class="cosmos-info-chars">');
          for (const [name, char] of charEntries.sort(([left], [right]) => left.localeCompare(right))) {
            const $charCard = $('<div class="cosmos-info-char-card">');
            $charCard.append($('<div class="cosmos-char-name">').text(name));
            if (char.clothing) {
              $charCard.append(makeLabeledLine('cosmos-char-detail', `${t`角色服装`}：`, char.clothing));
            }
            if (char.status) {
              $charCard.append(makeLabeledLine('cosmos-char-detail', `${t`角色状态`}：`, char.status));
            }
            $chars.append($charCard);
          }
          $list.append($chars);
        }

        $container.append($list);
        break;
      }

      case 'characters': {
        const chars = getStoredCharacters();
        if (chars.length === 0) {
          $container.append($('<div class="cosmos-empty">').text(t`当前聊天记录还没有人物信息。`));
          break;
        }

        const primary = chars.filter(c => c.type === 'primary');
        const secondary = chars.filter(c => c.type === 'secondary');

        const $list = $('<div class="cosmos-info-list">');

        if (primary.length > 0) {
          $list.append($('<div class="cosmos-info-sub-title">').text(t`主要角色`));
          for (const char of primary) {
            const $charCard = $('<div class="cosmos-character-card">');
            $charCard.append($('<div class="cosmos-char-name">').text(char.name));
            if (char.background) {
              $charCard.append(makeLabeledLine('cosmos-char-detail', `${t`背景介绍`}：`, char.background));
            }
            if (char.appearance) {
              $charCard.append(makeLabeledLine('cosmos-char-detail', `${t`外貌描写`}：`, char.appearance));
            }
            if (char.personality) {
              $charCard.append(makeLabeledLine('cosmos-char-detail', `${t`性格描写`}：`, char.personality));
            }
            $list.append($charCard);
          }
        }

        if (secondary.length > 0) {
          $list.append($('<div class="cosmos-info-sub-title">').text(t`次要角色`));
          for (const char of secondary) {
            const $charCard = $('<div class="cosmos-character-card">');
            $charCard.append($('<div class="cosmos-char-name">').text(char.name));
            if (char.brief) {
              $charCard.append($('<div class="cosmos-char-detail">').text(char.brief));
            }
            $list.append($charCard);
          }
        }

        $container.append($list);
        break;
      }

      case 'items': {
        const items = getStoredItems();
        if (items.length === 0) {
          $container.append($('<div class="cosmos-empty">').text(t`当前聊天记录还没有物品信息。`));
          break;
        }

        const $list = $('<div class="cosmos-info-list">');
        for (const item of items) {
          const $itemCard = $('<div class="cosmos-item-card">');
          $itemCard.append($('<div class="cosmos-item-name">').text(item.name));
          if (item.brief) {
            $itemCard.append($('<div class="cosmos-item-detail">').text(item.brief));
          }
          $list.append($itemCard);
        }
        $container.append($list);
        break;
      }

      case 'locations': {
        const locations = getStoredLocations();
        if (locations.length === 0) {
          $container.append($('<div class="cosmos-empty">').text(t`当前聊天记录还没有地点信息。`));
          break;
        }

        const $tree = $('<div class="cosmos-location-tree">');
        for (const world of locations) {
          const $worldNode = $('<div class="cosmos-location-node cosmos-location-world">');
          $worldNode.append(makeLabeledLine('cosmos-loc-header', `${t`世界/大陆`}：`, world.name));
          if (world.brief) {
            $worldNode.append($('<div class="cosmos-loc-desc">').text(world.brief));
          }

          const countries = Object.values(world.countries).sort((left, right) => left.name.localeCompare(right.name));
          for (const country of countries) {
            const $countryNode = $('<div class="cosmos-location-node cosmos-location-country">');
            $countryNode.append(makeLabeledLine('cosmos-loc-header', `${t`国家/地区`}：`, country.name));
            if (country.brief) {
              $countryNode.append($('<div class="cosmos-loc-desc">').text(country.brief));
            }

            const cities = Object.values(country.cities).sort((left, right) => left.name.localeCompare(right.name));
            for (const city of cities) {
              const $cityNode = $('<div class="cosmos-location-node cosmos-location-city">');
              $cityNode.append(makeLabeledLine('cosmos-loc-header', `${t`城市/城镇`}：`, city.name));
              if (city.brief) {
                $cityNode.append($('<div class="cosmos-loc-desc">').text(city.brief));
              }

              const scenes = Object.values(city.scenes).sort((left, right) => left.name.localeCompare(right.name));
              for (const scene of scenes) {
                const $sceneNode = $('<div class="cosmos-location-node cosmos-location-scene">');
                $sceneNode.append(makeLabeledLine('cosmos-loc-header', `${t`场景/建筑`}：`, scene.name));
                if (scene.brief) {
                  $sceneNode.append($('<div class="cosmos-loc-desc">').text(scene.brief));
                }

                const rooms = Object.values(scene.rooms).sort((left, right) => left.name.localeCompare(right.name));
                for (const room of rooms) {
                  const $roomNode = $('<div class="cosmos-location-node cosmos-location-room">');
                  $roomNode.append(makeLabeledLine('cosmos-loc-header', `${t`房间/具体地点`}：`, room.name));
                  if (room.brief) {
                    $roomNode.append($('<div class="cosmos-loc-desc">').text(room.brief));
                  }
                  $sceneNode.append($roomNode);
                }
                $cityNode.append($sceneNode);
              }
              $countryNode.append($cityNode);
            }
            $worldNode.append($countryNode);
          }
          $tree.append($worldNode);
        }
        $container.append($tree);
        break;
      }
    }
  } catch (error) {
    console.error('[CosmosMemory] 渲染状态栏 Tab 内容失败', error);
    $container.append($('<div class="cosmos-error">').text(t`数据加载失败`));
  }
}

/**
 * 刷新并渲染状态栏
 * @returns 是否成功获取 DOM 并挂载状态栏
 */
export function updateStatusBar(): boolean {
  if (!window.TavernHelper) {
    return false;
  }

  const { settings } = useSettingsStore();

  // 如果状态栏被关闭，移除已有状态栏并返回
  if (!settings.status_bar.enabled) {
    $('#chat .cosmos-memory-status-bar', window.parent.document).remove();
    return true;
  }

  // 根据各功能开关过滤可用的 Tab
  const allTabsConfig = [
    { id: 'current' as const, name: t`当前信息`, enabled: settings.current_info.enabled },
    { id: 'characters' as const, name: t`人物信息`, enabled: settings.characters.enabled },
    { id: 'items' as const, name: t`物品信息`, enabled: settings.items.enabled },
    { id: 'locations' as const, name: t`地点信息`, enabled: settings.locations.enabled },
  ];

  const enabledTabs = allTabsConfig.filter(tab => tab.enabled);

  // 没有任何功能开启时，不显示状态栏
  if (enabledTabs.length === 0) {
    $('#chat .cosmos-memory-status-bar', window.parent.document).remove();
    return true;
  }

  // 如果当前激活的 Tab 不在已启用列表中，切换到第一个可用 Tab
  if (!enabledTabs.some(tab => tab.id === activeTab)) {
    activeTab = enabledTabs[0]!.id;
  }

  // 1. 查找最新 AI 回复的楼层号
  const messageId = getLatestAiMessageId();
  if (messageId === null) {
    return false;
  }

  // 2. 获取对应的 DOM 容器
  const $msgText = window.TavernHelper.retrieveDisplayedMessage(messageId);
  if (!$msgText || $msgText.length === 0) {
    return false;
  }

  // 3. 移除已有的状态栏元素以防重复
  $('#chat .cosmos-memory-status-bar', window.parent.document).remove();

  // 4. 构建状态栏 DOM 树
  const $statusBar = $('<div class="cosmos-memory-status-bar">');
  const $tabs = $('<div class="cosmos-tabs">');

  enabledTabs.forEach(tab => {
    const $tab = $(`<div class="cosmos-tab" data-tab="${tab.id}">`).text(tab.name);
    if (tab.id === activeTab) {
      $tab.addClass('active');
    }

    $tab.on('click', () => {
      activeTab = tab.id;
      $statusBar.find('.cosmos-tab').removeClass('active');
      $tab.addClass('active');
      renderTabContent($statusBar.find('.cosmos-tab-content'));
    });

    $tabs.append($tab);
  });

  const $content = $('<div class="cosmos-tab-content">');
  $statusBar.append($tabs).append($content);

  renderTabContent($content);

  // 5. 将状态栏插入最新 AI 回复的末尾
  $msgText.append($statusBar);
  return true;
}

let retryCount = 0;

/**
 * 触发状态栏更新（防抖/异步）
 */
export function triggerUpdateStatusBar() {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }
  updateTimeout = setTimeout(() => {
    if (!window.TavernHelper) {
      if (retryCount < 30) {
        retryCount++;
        triggerUpdateStatusBar();
      } else {
        console.warn('[CosmosMemory] TavernHelper 初始化超时，跳过状态栏更新。');
      }
      return;
    }

    const success = updateStatusBar();
    if (!success) {
      // 如果获取最新消息的 DOM 失败（可能聊天列表尚未渲染完毕），在 200ms 后重试
      if (retryCount < 30) {
        retryCount++;
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          triggerUpdateStatusBar();
        }, 200);
      }
      return;
    }

    retryCount = 0;
  }, 100);
}

/**
 * 初始化状态栏监听器
 */
export function initStatusBar() {
  console.info('[CosmosMemory] 初始化状态栏监听器');

  // 监听酒馆核心渲染/更改事件
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
    triggerUpdateStatusBar();
  });

  eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
    triggerUpdateStatusBar();
  });

  eventSource.on(event_types.CHAT_CHANGED, () => {
    triggerUpdateStatusBar();
  });

  eventSource.on(event_types.CHAT_LOADED, () => {
    triggerUpdateStatusBar();
  });

  eventSource.on(event_types.MESSAGE_DELETED, () => {
    triggerUpdateStatusBar();
  });

  eventSource.on(event_types.MESSAGE_EDITED, () => {
    triggerUpdateStatusBar();
  });

  // 初次启动更新
  triggerUpdateStatusBar();
}
