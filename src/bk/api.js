import {api as real} from '../api';
import {mockApi,MOCK} from './mock';
// Preview mode (VITE_BK_PREVIEW=1) serves seeded in-memory data; otherwise the real platform API.
export const api=MOCK?mockApi:real;
