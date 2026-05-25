import axios, { AxiosHeaders } from 'axios';

export function getInternalToken() {
  return localStorage.getItem('internalToken') || '';
}

const token = getInternalToken();

export const api = axios.create({
  baseURL: '/api',
  headers: token ? { 'X-Internal-Token': token } : {},
});

api.interceptors.request.use((config) => {
  const latest = getInternalToken();
  const headers = AxiosHeaders.from(config.headers);
  if (latest) {
    headers.set('X-Internal-Token', latest);
  } else {
    headers.delete('X-Internal-Token');
  }
  config.headers = headers;
  return config;
});

export function setInternalToken(t: string) {
  const next = t.trim();
  if (!next) {
    localStorage.removeItem('internalToken');
    delete api.defaults.headers['X-Internal-Token'];
    return;
  }
  localStorage.setItem('internalToken', next);
  api.defaults.headers['X-Internal-Token'] = next;
}
