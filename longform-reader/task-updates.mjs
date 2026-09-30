// Serialize local read/modify/write operations. Conditional cloud writes also
// protect against another server instance changing the same task.
export function createTaskUpdater({ read, write, isConflict = () => false }) {
  const pending = new Map();
  return async function updateTask(id, change) {
    const previous = pending.get(id) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const task = await read(id);
        const result = change(task);
        try {
          await write(task, { conditional: true });
          return result;
        } catch (error) {
          if (!isConflict(error) || attempt === 4) throw error;
        }
      }
    });
    pending.set(id, operation);
    try { return await operation; }
    finally { if (pending.get(id) === operation) pending.delete(id); }
  };
}
