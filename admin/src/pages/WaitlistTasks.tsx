import { useState, useEffect, useCallback } from 'react';
import { getWaitlistTasks, createWaitlistTask, updateWaitlistTask, deleteWaitlistTask } from '../api';

interface Task {
  id: string;
  taskId: string;
  title: string;
  description: string;
  xpReward: number;
  active: boolean;
  sortOrder: number;
  requiresTask: string | null;
  category: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export default function WaitlistTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWaitlistTasks();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleActive = async (task: Task) => {
    await updateWaitlistTask(task.id, { active: !task.active });
    load();
  };

  const handleDelete = async (task: Task) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    await deleteWaitlistTask(task.id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Waitlist Tasks ({tasks.length})</h2>
        <div className="header-actions">
          <button className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowCreate(true)}>
            Add Task
          </button>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>Order</th>
              <th>Task ID</th>
              <th>Title</th>
              <th>XP</th>
              <th>Category</th>
              <th>Requires</th>
              <th>Status</th>
              <th>Metadata</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No tasks found</td></tr>
            ) : tasks.map((t) => (
              <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                <td style={{ textAlign: 'center' }}>{t.sortOrder}</td>
                <td className="mono" style={{ fontSize: 12 }}>{t.taskId}</td>
                <td style={{ fontWeight: 600 }}>{t.title}</td>
                <td>
                  <span className="badge badge-blue">+{t.xpReward} XP</span>
                </td>
                <td><span className="badge badge-yellow">{t.category}</span></td>
                <td>
                  {t.requiresTask
                    ? <span className="mono" style={{ fontSize: 12 }}>{t.requiresTask}</span>
                    : <span style={{ color: '#999' }}>—</span>
                  }
                </td>
                <td>
                  <span
                    className={`badge ${t.active ? 'badge-green' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleToggleActive(t)}
                    title="Click to toggle"
                  >
                    {t.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  {Object.keys(t.metadata).length > 0
                    ? <span className="mono" style={{ fontSize: 11 }} title={JSON.stringify(t.metadata)}>
                        {JSON.stringify(t.metadata).slice(0, 30)}{JSON.stringify(t.metadata).length > 30 ? '...' : ''}
                      </span>
                    : <span style={{ color: '#999' }}>—</span>
                  }
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setEditTask(t)}>
                      Edit
                    </button>
                    <button className="btn-danger" onClick={() => handleDelete(t)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <TaskFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
          existingTasks={tasks}
        />
      )}

      {editTask && (
        <TaskFormModal
          task={editTask}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); load(); }}
          existingTasks={tasks}
        />
      )}
    </div>
  );
}

function TaskFormModal({
  task,
  onClose,
  onSaved,
  existingTasks,
}: {
  task?: Task;
  onClose: () => void;
  onSaved: () => void;
  existingTasks: Task[];
}) {
  const isEdit = !!task;
  const [taskId, setTaskId] = useState(task?.taskId || '');
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [xpReward, setXpReward] = useState(task?.xpReward || 100);
  const [active, setActive] = useState(task?.active !== false);
  const [sortOrder, setSortOrder] = useState(task?.sortOrder || 0);
  const [requiresTask, setRequiresTask] = useState(task?.requiresTask || '');
  const [category, setCategory] = useState(task?.category || 'social');
  const [metadataStr, setMetadataStr] = useState(
    task?.metadata && Object.keys(task.metadata).length > 0 ? JSON.stringify(task.metadata, null, 2) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!taskId.trim() || !title.trim() || !category.trim()) {
      setError('Task ID, title, and category are required');
      return;
    }

    let metadata: Record<string, any> = {};
    if (metadataStr.trim()) {
      try {
        metadata = JSON.parse(metadataStr);
      } catch {
        setError('Invalid JSON in metadata');
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      if (isEdit) {
        const data = await updateWaitlistTask(task!.id, {
          title,
          description,
          xpReward: Number(xpReward),
          active,
          sortOrder: Number(sortOrder),
          requiresTask: requiresTask || undefined,
          category,
          metadata,
        });
        if (!data.success) {
          setError(data.error || 'Failed to update task');
          return;
        }
      } else {
        const data = await createWaitlistTask({
          taskId: taskId.trim(),
          title,
          description,
          xpReward: Number(xpReward),
          active,
          sortOrder: Number(sortOrder),
          requiresTask: requiresTask || undefined,
          category,
          metadata,
        });
        if (!data.success) {
          setError(data.error || 'Failed to create task');
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError('Failed to save task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3>{isEdit ? 'Edit Task' : 'Add Task'}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Task ID</label>
            <input
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="e.g. connect_email"
              disabled={isEdit}
              style={isEdit ? { opacity: 0.5 } : {}}
            />
          </div>
          <div className="form-group">
            <label>Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. social, action"
            />
          </div>
        </div>

        <div className="form-group">
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Connect your email"
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>XP Reward</label>
            <input
              type="number"
              min={1}
              value={xpReward}
              onChange={(e) => setXpReward(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label>Sort Order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label>Requires Task</label>
            <select value={requiresTask} onChange={(e) => setRequiresTask(e.target.value)}>
              <option value="">None</option>
              {existingTasks
                .filter((t) => t.taskId !== taskId)
                .map((t) => (
                  <option key={t.taskId} value={t.taskId}>{t.title}</option>
                ))
              }
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Metadata (JSON)</label>
          <textarea
            value={metadataStr}
            onChange={(e) => setMetadataStr(e.target.value)}
            placeholder='e.g. {"tweetId": "123456"}'
            rows={3}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>

        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
          <input
            type="checkbox"
            id="task-active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label htmlFor="task-active" style={{ marginBottom: 0 }}>Active</label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            style={{ width: 'auto' }}
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
