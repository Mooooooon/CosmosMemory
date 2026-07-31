<<<<<<< HEAD
import { registerSummaryEvents } from '@/core/events';
=======
>>>>>>> cc8bc4cededdbc9368b632c8b27765a709111ca2
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
>>>>>>> cc8bc4cededdbc9368b632c8b27765a709111ca2
}
