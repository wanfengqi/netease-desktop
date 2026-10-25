import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useSettingsStore } from './stores/settings';
import './styles/base.css';

const app = createApp(App);
app.use(createPinia());
useSettingsStore();
app.mount('#app');
