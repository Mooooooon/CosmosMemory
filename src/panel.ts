import { registerSummaryEvents } from '@/core/events';
import Panel from '@/Panel.vue';
import { App } from 'vue';

const app = createApp(Panel);

const pinia = createPinia();
app.use(pinia);

declare module 'vue' {
  interface ComponentCustomProperties {
    t: typeof t;
  }
}
const i18n = {
  install: (app: App) => {
    app.config.globalProperties.t = t;
  },
};
app.use(i18n);

export function initPanel() {
  console.info('[CosmosMemory] 初始化插件面板');
  const $app = $('<div id="cosmos_memory">').appendTo('#extensions_settings2');
  app.mount($app[0]);
  registerSummaryEvents();
}
