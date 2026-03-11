/**
 * Logger service — stores log entries.
 */
export default class LoggerService {
  private logs: Array<{ message: string; timestamp: string }> = [];

  async log(params: { message: string }): Promise<{ logged: true; total: number }> {
    this.logs.push({ message: params.message, timestamp: new Date().toISOString() });
    return { logged: true, total: this.logs.length };
  }

  async entries(): Promise<Array<{ message: string; timestamp: string }>> {
    return [...this.logs];
  }
}
