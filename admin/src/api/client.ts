import axios from 'axios';

const token = localStorage.getItem('internalToken') || '';

export const api = axios.create({
  baseURL: '/api',
  headers: token ? { 'X-Internal-Token': token } : {},
});

export function setInternalToken(t: string) {
  localStorage.setItem('internalToken', t);
  api.defaults.headers['X-Internal-Token'] = t;
}
