import {api as real} from '../api';
import {mockApi,MOCK} from './mock';
// Preview mode (VITE_BK_PREVIEW=1) serves seeded in-memory data; otherwise the real platform API.
// A dev server started with VITE_MOCK_API=0 (npm run dev:preview) talks to a real backend, so the Agent pages must read the same data as chat.
export const api=MOCK&&import.meta.env.VITE_MOCK_API!=='0'?mockApi:real;
