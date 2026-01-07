import { AsyncLocalStorage } from 'async_hooks';

export interface ExecutionContext {
  outputHandler?: (data: any) => void;
}

export const executionContext = new AsyncLocalStorage<ExecutionContext>();
