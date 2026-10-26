import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { netease } from './data/repository';
import { useConfigStore } from './stores/config';
import { useSettingsStore } from './stores/settings';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
useSettingsStore();

// 网易云登录态接线：取址/榜单/推荐都走共享单例，cookie 实时读 config store（只读不写，
// 持久化仍只有 stores/config 一条出口）。缺这一步 = 单例恒为空 cookie，
// 网易云按未登录返回 30~48s 试听片段，用户看到的就是"歌只有 30 秒"。
netease.setCookieProvider(() => useConfigStore().cookie);

app.mount('#app');
