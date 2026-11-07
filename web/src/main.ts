import { PROXY_URL } from './config.ts';
import { OUTLETS } from './state/defaults.ts';
import { createApp } from './ui/app.ts';
import './ui/styles/tokens.css';
import './ui/styles/app.css';

const root = document.getElementById('app');
if (root) {
  createApp(root, {
    proxyUrl: PROXY_URL,
    outlets: OUTLETS,
    hostLocale: navigator.language || 'en',
  }).start();
}
