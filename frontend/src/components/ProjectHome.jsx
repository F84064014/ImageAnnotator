import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { API_URL, api } from '../api/client';
import { DEFAULT_ATTRIBUTES } from '../constants/attributes';

export default function ProjectHome({ onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadProjects() {
    setLoading(true);
    setError('');
    try {
      setProjects(await api('/projects'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <main className="page">
      <section className="workspace">
        <div className="topbar">
          <div>
            <h1>Image Annotator</h1>
            <p>{projects.length} projects</p>
          </div>
          <div className="topbarActions">
            <ExportProjects projects={projects} />
            <ImportProject onImported={loadProjects} />
            <CreateProject onCreated={loadProjects} />
          </div>
        </div>

        {error && <div className="alert">{error}</div>}
        {loading ? (
          <div className="empty">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="empty">
            <FolderOpen size={42} />
            <span>No projects yet</span>
          </div>
        ) : (
          <div className="projectList">
            {projects.map((project) => (
              <div className="projectItem" key={project.id}>
                <button className="projectOpen" onClick={() => onOpenProject(project.id)}>
                  <strong>{project.name}</strong>
                  <span>{project.image_directory}</span>
                </button>
                <div className="projectStats">
                  <span>{project.annotated_count}/{project.image_count}</span>
                  <DeleteProject project={project} onDeleted={loadProjects} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ExportProjects({ projects }) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function openExport() {
    setSelectedIds(projects.map((project) => project.id));
    setError('');
    setOpen(true);
  }

  function toggleProject(projectId) {
    setSelectedIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ));
  }

  async function exportSelected() {
    if (selectedIds.length === 0) {
      setError('Select at least one project');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/projects/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: selectedIds }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Export failed');
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedFilenameMatch = disposition.match(/filename\*=utf-8''([^;]+)/i);
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = encodedFilenameMatch
        ? decodeURIComponent(encodedFilenameMatch[1])
        : filenameMatch?.[1] || 'ExportData.zip';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="secondary" onClick={openExport} disabled={projects.length === 0}>
        <Download size={18} />Export
      </button>
      {open && (
        <div className="modalBackdrop" onMouseDown={() => setOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Export projects</h2>
            <div className="exportProjectList">
              {projects.map((project) => (
                <label className="exportProjectOption" key={project.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(project.id)}
                    onChange={() => toggleProject(project.id)}
                  />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.image_count} images</small>
                  </span>
                </label>
              ))}
            </div>
            {error && <div className="alert">{error}</div>}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" onClick={exportSelected} disabled={busy || selectedIds.length === 0}>
                <Download size={18} />{busy ? 'Exporting...' : 'Export zip'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ImportProject({ onImported }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api('/projects/import', {
        method: 'POST',
        body: formData,
      });
      await onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  return (
    <div className="importProject">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={importFile}
        hidden
      />
      <button className="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
        <FileUp size={18} />{busy ? 'Importing...' : 'Import JSON'}
      </button>
      {error && <span className="inlineError">{error}</span>}
    </div>
  );
}

function CreateProject({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('/images');
  const [attributesText, setAttributesText] = useState(DEFAULT_ATTRIBUTES.join(','));
  const [maskLabels, setMaskLabels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          image_directory: directory,
          attributes: attributesText.split(',').map((item) => item.trim()).filter(Boolean),
          mask_labels: maskLabels
            .map((label) => ({
              name: label.name.trim(),
              directory: label.directory.trim(),
              color: label.color || '#ff3b8f',
              opacity: Number(label.opacity ?? 0.55),
            }))
            .filter((label) => label.name && label.directory),
        }),
      });
      setOpen(false);
      setName('');
      await onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}><Plus size={18} />Create</button>
      {open && (
        <div className="modalBackdrop" onMouseDown={() => setOpen(false)}>
          <form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
            <h2>Create project</h2>
            <label>
              Project name
              <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
            </label>
            <label>
              Image directory
              <input value={directory} onChange={(event) => setDirectory(event.target.value)} required />
            </label>
            <label>
              Attributes
              <textarea value={attributesText} onChange={(event) => setAttributesText(event.target.value)} required />
            </label>
            <div className="settingsSectionHeader">
              <strong>Mask labels</strong>
              <button
                type="button"
                className="textButton"
                onClick={() => setMaskLabels((current) => [...current, {
                  name: 'Mask',
                  directory: '/images/masks',
                  color: '#ff3b8f',
                  opacity: 0.55,
                }])}
              >
                <Plus size={16} />Add
              </button>
            </div>
            <div className="settingsAttributeList">
              {maskLabels.map((label, labelIndex) => (
                <div className="maskSettingRow" key={labelIndex}>
                  <input
                    value={label.name}
                    placeholder="Mask name"
                    onChange={(event) => setMaskLabels((current) => current.map((item, itemIndex) => (
                      itemIndex === labelIndex ? { ...item, name: event.target.value } : item
                    )))}
                  />
                  <input
                    value={label.directory}
                    placeholder="Mask directory"
                    onChange={(event) => setMaskLabels((current) => current.map((item, itemIndex) => (
                      itemIndex === labelIndex ? { ...item, directory: event.target.value } : item
                    )))}
                  />
                  <input
                    type="color"
                    title="Mask color"
                    value={label.color || '#ff3b8f'}
                    onChange={(event) => setMaskLabels((current) => current.map((item, itemIndex) => (
                      itemIndex === labelIndex ? { ...item, color: event.target.value } : item
                    )))}
                  />
                  <label className="maskOpacityControl">
                    <span>{Math.round(Number(label.opacity ?? 0.55) * 100)}%</span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={label.opacity ?? 0.55}
                      onChange={(event) => setMaskLabels((current) => current.map((item, itemIndex) => (
                        itemIndex === labelIndex ? { ...item, opacity: event.target.value } : item
                      )))}
                    />
                  </label>
                  <button
                    type="button"
                    className="iconButton danger"
                    title="Delete mask label"
                    onClick={() => setMaskLabels((current) => current.filter((_, itemIndex) => itemIndex !== labelIndex))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            {error && <div className="alert">{error}</div>}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Scanning...' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function DeleteProject({ project, onDeleted }) {
  async function remove() {
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    await api(`/projects/${project.id}`, { method: 'DELETE' });
    await onDeleted();
  }

  return (
    <button className="iconButton danger" title="Delete project" onClick={remove}>
      <Trash2 size={17} />
    </button>
  );
}
