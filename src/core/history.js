// Undo/redo of whole-terrain snapshots (257² floats ≈ 264 KB each).
export class History {
  constructor(limit = 40) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  // Drop the most recent snapshot without applying it (used to cancel a stroke)
  discardLast() {
    return this.undoStack.pop() || null;
  }

  undo(current) {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current) {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
