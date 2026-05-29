import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FolderOpen, Minimize2, Plus, Trash2 } from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const ATTRIBUTE_STATES = {
  0: { label: 'False', next: 2 },
  1: { label: 'True', next: 0 },
  2: { label: 'Unknown', next: 1 },
};
const ATTRIBUTE_COLORS = {
  black: '#111827',
  blue: '#2563eb',
  brown: '#8b5e34',
  green: '#16a34a',
  grey: '#6b7280',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#9333ea',
  red: '#dc2626',
  white: '#ffffff',
  yellow: '#eab308',
};

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Request failed');
  }
  if (response.status === 204) return null;
  return response.json();
}

function App() {
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
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

  if (activeProjectId) {
    return <Annotator projectId={activeProjectId} onBack={() => { setActiveProjectId(null); loadProjects(); }} />;
  }

  return (
    <main className="page">
      <section className="workspace">
        <div className="topbar">
          <div>
            <h1>Image Annotator</h1>
            <p>{projects.length} projects</p>
          </div>
          <CreateProject onCreated={loadProjects} />
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
                <button className="projectOpen" onClick={() => setActiveProjectId(project.id)}>
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

function CreateProject({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [directory, setDirectory] = useState('/images');
  const [attributesText, setAttributesText] = useState('Age-Young,Age-Adult,Age-Old,Gender-Female,Gender-Male,UpperBody-Color-Black,UpperBody-Color-Blue,UpperBody-Color-Brown,UpperBody-Color-Green,UpperBody-Color-Grey,UpperBody-Color-Orange,UpperBody-Color-Pink,UpperBody-Color-Purple,UpperBody-Color-Red,UpperBody-Color-White,UpperBody-Color-Yellow,LowerBody-Color-Black,LowerBody-Color-Blue,LowerBody-Color-Brown,LowerBody-Color-Green,LowerBody-Color-Grey,LowerBody-Color-Orange,LowerBody-Color-Pink,LowerBody-Color-Purple,LowerBody-Color-Red,LowerBody-Color-White,LowerBody-Color-Yellow,Accessory-Backpack,Accessory-Bag,Accessory-Hat');
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
  async function remove(event) {
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

function normalizeAttributeValue(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return [0, 1, 2].includes(value) ? value : 2;
}

function groupAttributes(attributes) {
  const groups = [];
  const groupMap = new Map();

  attributes.forEach((attribute) => {
    const separatorIndex = attribute.lastIndexOf('-');
    const groupName = separatorIndex > 0 ? attribute.slice(0, separatorIndex).trim() : 'Attributes';
    const label = separatorIndex > 0 ? attribute.slice(separatorIndex + 1).trim() : attribute;
    const finalGroupName = groupName || 'Attributes';
    const finalLabel = label || attribute;

    if (!groupMap.has(finalGroupName)) {
      const group = { name: finalGroupName, items: [] };
      groupMap.set(finalGroupName, group);
      groups.push(group);
    }
    groupMap.get(finalGroupName).items.push({ key: attribute, label: finalLabel });
  });

  return groups;
}

function TriStateAttribute({ label, value, onChange }) {
  const checkboxRef = useRef(null);
  const normalizedValue = normalizeAttributeValue(value);
  const color = ATTRIBUTE_COLORS[label.trim().toLowerCase()];
  const rowStyle = color ? { '--attribute-color': color } : undefined;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = normalizedValue === 2;
    }
  }, [normalizedValue]);

  function cycleState(event) {
    event.preventDefault();
    onChange(ATTRIBUTE_STATES[normalizedValue].next);
  }

  return (
    <label
      className={`attributeRow attributeState${normalizedValue} ${color ? 'attributeColorRow' : ''}`}
      style={rowStyle}
    >
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={normalizedValue === 1}
        readOnly
        onClick={cycleState}
      />
      {color && <span className="attributeColorSwatch" aria-hidden="true" />}
      <span>{label}</span>
      <em>{ATTRIBUTE_STATES[normalizedValue].label}</em>
    </label>
  );
}

function Annotator({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [displayResized, setDisplayResized] = useState(false);

  async function loadProject() {
    setError('');
    try {
      setProject(await api(`/projects/${projectId}`));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadProject();
  }, [projectId]);

  const image = project?.images[index];
  const annotatedCount = useMemo(() => project?.images.filter((item) => item.annotated).length || 0, [project]);
  const attributeGroups = useMemo(() => groupAttributes(project?.attributes || []), [project]);

  function goNext() {
    setIndex((current) => Math.min(current + 1, (project?.images.length || 1) - 1));
  }

  function goPrev() {
    setIndex((current) => Math.max(current - 1, 0));
  }

  async function updateAttribute(attribute, value) {
    if (!image) return;
    const nextAttributes = { ...image.attributes, [attribute]: normalizeAttributeValue(value) };
    const updated = await api(`/projects/${project.id}/images/${image.id}/annotation`, {
      method: 'PUT',
      body: JSON.stringify({ attributes: nextAttributes }),
    });
    setProject((current) => ({
      ...current,
      images: current.images.map((item) => (item.id === image.id ? updated : item)),
    }));
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.target.matches('input, textarea, button')) return;
      if (event.key.toLowerCase() === 'f') goNext();
      if (event.key.toLowerCase() === 'd') goPrev();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project]);

  if (error) return <main className="page"><div className="alert">{error}</div></main>;
  if (!project || !image) return <main className="page"><div className="empty">Loading project...</div></main>;

  return (
    <main className="annotator">
      <header className="annotatorHeader">
        <button className="iconButton" title="Back" onClick={onBack}><ArrowLeft size={19} /></button>
        <div className="titleBlock">
          <h1>{project.name}</h1>
          <p>{index + 1}/{project.images.length} images / {annotatedCount} annotated</p>
        </div>
        <a className="primary" href={`${API_URL}/projects/${project.id}/export`}>
          <Download size={18} />Export CSV
        </a>
      </header>

      <section className="annotatorBody">
        <aside className="sidePanel">
          <div className="imageMeta">
            <strong>{image.path.split(/[\\/]/).pop()}</strong>
            <span>{image.path}</span>
          </div>
          <div className="attributeList">
            {attributeGroups.map((group) => (
              <fieldset className="attributeGroup" key={group.name}>
                <legend>{group.name}</legend>
                {group.items.map((attribute) => (
                  <TriStateAttribute
                    key={attribute.key}
                    label={attribute.label}
                    value={image.attributes[attribute.key]}
                    onChange={(value) => updateAttribute(attribute.key, value)}
                  />
                ))}
              </fieldset>
            ))}
          </div>
          <div className="navButtons">
            <button className="secondary" onClick={goPrev} disabled={index === 0}><ChevronLeft size={18} />Prev</button>
            <button className="secondary" onClick={() => setDisplayResized((current) => !current)}>
              <Minimize2 size={18} />{displayResized ? 'Original' : 'Resize'}
            </button>
            <button className="secondary" onClick={goNext} disabled={index === project.images.length - 1}>Next<ChevronRight size={18} /></button>
          </div>
        </aside>
        <div className={`imageStage ${displayResized ? 'imageStageResized' : ''}`}>
          <img
            src={`${API_URL}/image?path=${encodeURIComponent(image.path)}`}
            alt={image.path}
          />
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
