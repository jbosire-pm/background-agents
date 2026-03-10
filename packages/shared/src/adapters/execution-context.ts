/**
 * Portable execution context interface.
 *
 * Replaces ExecutionContext.waitUntil and ctx.waitUntil from Cloudflare Workers.
 * Implementations: Workers ExecutionContext, Node.js fire-and-forget.
 */

export interface ExecutionContextAdapter {
  waitUntil(promise: Promise<unknown>): void;
}

export class NodeExecutionContext implements ExecutionContextAdapter {
  private onError?: (err: unknown) => void;

  constructor(onError?: (err: unknown) => void) {
    this.onError = onError;
  }

  waitUntil(promise: Promise<unknown>): void {
    promise.catch((err) => {
      this.onError?.(err);
    });
  }
}
