/**
 * A @stateful photon for testing event emission and __meta attachment.
 * Plain class — no Photon base class import needed.
 * @stateful
 */
export default class Todo {
  private items: Array<{ id: number; title: string; done: boolean }> = [];
  private nextId = 1;

  /**
   * Add a todo item
   * @param title The todo title
   */
  async add(params: { title: string }) {
    const item = { id: this.nextId++, title: params.title, done: false };
    this.items.push(item);
    return item;
  }

  /**
   * List all todos
   */
  async list() {
    return this.items;
  }

  /**
   * Mark a todo as done
   * @param id The todo ID
   */
  async done(params: { id: number }) {
    const item = this.items.find(i => i.id === params.id);
    if (!item) throw new Error(`Todo ${params.id} not found`);
    item.done = true;
    return item;
  }
}
