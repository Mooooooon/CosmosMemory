<<<<<<< HEAD
import { registerSummaryEvents } from '@/core/events';
=======
>>>>>>> f4129ea60a6332c92c6d17819aca0a1b420d99dd
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
<<<<<<< HEAD
  console.info('[CosmosMemory] 初始化插件面板');
  const $app = $('<div id="cosmos_memory">').appendTo('#extensions_settings2');
  app.mount($app[0]);
  registerSummaryEvents();
=======
  const $app = $('<div id="tavern_extension_example">').appendTo('#extensions_settings2');
  app.mount($app[0]);
>>>>>>> f4129ea60a6332c92c6d17819aca0a1b420d99dd
}
