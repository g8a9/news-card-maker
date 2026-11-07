import { PROXY_URL } from './config.ts';
import { checkHealth } from './health.ts';

// M0 placeholder: proves the web app can reach the proxy. Replaced by the real app in M4.
const root = document.getElementById('app');
if (root) {
  root.style.cssText =
    'font: 14px/1.45 system-ui, sans-serif; color: #ededef; background: #0a0a0b; min-height: 100vh;' +
    'display: grid; place-content: center; gap: 8px; text-align: center; margin: 0;';
  document.body.style.margin = '0';
  const title = document.createElement('h1');
  title.textContent = 'News Card Maker';
  title.style.cssText = 'font-size: 15px; font-weight: 600; margin: 0;';
  const status = document.createElement('p');
  status.id = 'proxy-status';
  status.style.cssText = 'color: #9a9aa3; margin: 0;';
  status.textContent = 'Proxy: checking…';
  root.append(title, status);

  checkHealth(PROXY_URL).then((health) => {
    status.textContent = health.ok
      ? `Proxy: ok${health.version ? ` (${health.version})` : ''}`
      : 'Proxy: unreachable';
  });
}
