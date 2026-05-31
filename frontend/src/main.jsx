import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileUp, Filter, FolderOpen, Minimize2, Pipette, Plus, RefreshCw, Trash2 } from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const ATTRIBUTE_STATES = {
  0: { label: 'False', next: 1 },
  1: { label: 'True', next: 2 },
  2: { label: 'Unknown', next: 0 },
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
  const headers = options.body instanceof FormData
    ? options.headers || {}
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(`${API_URL}${path}`, {
    headers,
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
          <div className="topbarActions">
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

function imageMatchesFilters(image, filters) {
  if (filters.annotated === 'annotated' && !image.annotated) return false;
  if (filters.annotated === 'notAnnotated' && image.annotated) return false;
  return Object.entries(filters.attributes).every(([attribute, value]) => (
    value === 'all' || normalizeAttributeValue(image.attributes?.[attribute]) === Number(value)
  ));
}

function hasSelectedAttribute(image, attributes) {
  return attributes.some((attribute) => normalizeAttributeValue(image.attributes?.[attribute]) !== 0);
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
      onMouseDown={(event) => event.preventDefault()}
    >
      <input
        ref={checkboxRef}
        type="checkbox"
        tabIndex={-1}
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

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    if (max === g) hue = 60 * ((b - r) / delta + 2);
    if (max === b) hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return {
    h: hue,
    s: max === 0 ? 0 : (delta / max) * 100,
    v: max * 100,
  };
}

function classifyColor({ h, s, v }) {
  if (v < 18) return 'Black';
  if (s < 12 && v > 84) return 'White';
  if (s < 18) return 'Grey';
  if ((h >= 0 && h < 14) || h >= 345) return 'Red';
  if (h >= 14 && h < 42 && v < 62) return 'Brown';
  if (h >= 14 && h < 42) return 'Orange';
  if (h >= 42 && h < 72) return 'Yellow';
  if (h >= 72 && h < 170) return 'Green';
  if (h >= 170 && h < 255) return 'Blue';
  if (h >= 255 && h < 292) return 'Purple';
  if (h >= 292 && h < 345) return 'Pink';
  return 'Grey';
}

function getSampleBox(start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(deltaX)),
    height: Math.max(1, Math.abs(deltaY)),
  };
}

function Annotator({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [displayResized, setDisplayResized] = useState(false);
  const [samplerActive, setSamplerActive] = useState(false);
  const [sampleBox, setSampleBox] = useState(null);
  const [sampleResult, setSampleResult] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ annotated: 'all', attributes: {} });
  const dragStartRef = useRef(null);
  const imageRef = useRef(null);

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

  const filteredImages = useMemo(() => {
    const images = project?.images || [];
    return images.filter((item) => imageMatchesFilters(item, filters));
  }, [project, filters]);
  const image = filteredImages[index];
  const annotatedCount = useMemo(() => project?.images.filter((item) => item.annotated).length || 0, [project]);
  const attributeGroups = useMemo(() => groupAttributes(project?.attributes || []), [project]);
  const activeFilterCount = useMemo(() => (
    (filters.annotated === 'all' ? 0 : 1)
    + Object.values(filters.attributes).filter((value) => value !== 'all').length
  ), [filters]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(filteredImages.length - 1, 0)));
  }, [filteredImages.length]);

  async function markCurrentAnnotated() {
    if (!project || !image || image.annotated) return image;
    if (!hasSelectedAttribute(image, project.attributes)) return image;
    const updated = await api(`/projects/${project.id}/images/${image.id}/annotated`, { method: 'PUT' });
    setProject((current) => ({
      ...current,
      images: current.images.map((item) => (item.id === image.id ? updated : item)),
    }));
    return updated;
  }

  async function goNext() {
    setSampleBox(null);
    setSampleResult(null);
    let updated = image;
    try {
      updated = await markCurrentAnnotated();
    } catch (err) {
      setError(err.message);
      return;
    }
    setIndex((current) => {
      if (updated && !imageMatchesFilters(updated, filters)) {
        return Math.min(current, Math.max(filteredImages.length - 2, 0));
      }
      return Math.min(current + 1, Math.max(filteredImages.length - 1, 0));
    });
  }

  async function goPrev() {
    setSampleBox(null);
    setSampleResult(null);
    let updated = image;
    try {
      updated = await markCurrentAnnotated();
    } catch (err) {
      setError(err.message);
      return;
    }
    setIndex((current) => {
      if (updated && !imageMatchesFilters(updated, filters)) {
        return Math.max(current - 1, 0);
      }
      return Math.max(current - 1, 0);
    });
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

  async function scanImages() {
    if (!project) return;
    setScanBusy(true);
    setError('');
    try {
      const updated = await api(`/projects/${project.id}/scan`, { method: 'POST' });
      setProject(updated);
      setSampleBox(null);
      setSampleResult(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanBusy(false);
    }
  }

  function updateAnnotatedFilter(value) {
    setIndex(0);
    setSampleBox(null);
    setSampleResult(null);
    setFilters((current) => ({ ...current, annotated: value }));
  }

  function updateAttributeFilter(attribute, value) {
    setIndex(0);
    setSampleBox(null);
    setSampleResult(null);
    setFilters((current) => ({
      ...current,
      attributes: {
        ...current.attributes,
        [attribute]: value,
      },
    }));
  }

  function clearFilters() {
    setIndex(0);
    setSampleBox(null);
    setSampleResult(null);
    setFilters({ annotated: 'all', attributes: {} });
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.target.matches('textarea, select, [contenteditable="true"]')) return;
      if (event.target.matches('input') && event.target.type !== 'checkbox') return;
      if (event.key.toLowerCase() === 'f') goNext();
      if (event.key.toLowerCase() === 'd') goPrev();
      if (event.key.toLowerCase() === 's') setSamplerActive((current) => !current);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project, image, filters, filteredImages.length]);

  function getImagePoint(event) {
    const imageElement = imageRef.current;
    if (!imageElement) return null;
    const rect = imageElement.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    return { x, y, rect };
  }

  function startSampling(event) {
    if (!samplerActive) return;
    const point = getImagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point;
    setSampleResult(null);
    setSampleBox({ x: point.x, y: point.y, width: 1, height: 1 });
  }

  function updateSampling(event) {
    if (!samplerActive || !dragStartRef.current) return;
    const point = getImagePoint(event);
    if (!point) return;
    event.preventDefault();
    setSampleBox(getSampleBox(dragStartRef.current, point));
  }

  function finishSampling(event) {
    if (!samplerActive || !dragStartRef.current) return;
    const point = getImagePoint(event);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!point || !imageRef.current) return;
    event.preventDefault();

    const box = getSampleBox(start, point);
    const imageElement = imageRef.current;
    if (!imageElement.complete || imageElement.naturalWidth === 0 || imageElement.naturalHeight === 0) {
      setSampleResult({ error: 'Image is not ready for color sampling yet' });
      return;
    }
    const scaleX = imageElement.naturalWidth / point.rect.width;
    const scaleY = imageElement.naturalHeight / point.rect.height;
    const sourceX = Math.round(box.x * scaleX);
    const sourceY = Math.round(box.y * scaleY);
    const sourceWidth = Math.max(1, Math.round(box.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(box.height * scaleY));

    let pixels;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        imageElement,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      pixels = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
    } catch (err) {
      setSampleResult({ error: 'Unable to sample this image. Please refresh after the image finishes loading.' });
      return;
    }

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      red += pixels[offset];
      green += pixels[offset + 1];
      blue += pixels[offset + 2];
      count += 1;
    }

    const rgb = {
      r: Math.round(red / count),
      g: Math.round(green / count),
      b: Math.round(blue / count),
    };
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const color = classifyColor(hsv);
    setSampleBox(box);
    setSampleResult({ rgb, hsv, color });
    setSamplerActive(false);
  }

  if (error) return <main className="page"><div className="alert">{error}</div></main>;
  if (!project) return <main className="page"><div className="empty">Loading project...</div></main>;
  const hasFilterResults = filteredImages.length > 0;

  return (
    <main className="annotator">
      <header className="annotatorHeader">
        <button className="iconButton" title="Back" onClick={onBack}><ArrowLeft size={19} /></button>
        <div className="titleBlock">
          <h1>{project.name}</h1>
          <p>
            {hasFilterResults ? index + 1 : 0}/{filteredImages.length} shown / {project.images.length} images / {annotatedCount} annotated
          </p>
        </div>
        <div className="annotatorActions">
          <div className="filterMenu">
            <button className={`secondary ${filtersOpen ? 'activeTool' : ''}`} onClick={() => setFiltersOpen((current) => !current)}>
              <Filter size={18} />Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            {filtersOpen && (
              <div className="filterPanel">
                <div className="filterPanelHeader">
                  <strong>Filters</strong>
                  <button className="textButton" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear</button>
                </div>
                <label>
                  Annotated
                  <select value={filters.annotated} onChange={(event) => updateAnnotatedFilter(event.target.value)}>
                    <option value="all">All</option>
                    <option value="annotated">Annotated</option>
                    <option value="notAnnotated">Not annotated</option>
                  </select>
                </label>
                <div className="filterAttributeList">
                  {project.attributes.map((attribute) => (
                    <label key={attribute}>
                      {attribute}
                      <select
                        value={filters.attributes[attribute] || 'all'}
                        onChange={(event) => updateAttributeFilter(attribute, event.target.value)}
                      >
                        <option value="all">All</option>
                        <option value="1">True</option>
                        <option value="0">False</option>
                        <option value="2">Unknown</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className="secondary" onClick={scanImages} disabled={scanBusy}>
            <RefreshCw size={18} />{scanBusy ? 'Scanning...' : 'Scan'}
          </button>
          <a className="primary" href={`${API_URL}/projects/${project.id}/export`}>
            <Download size={18} />Export CSV
          </a>
        </div>
      </header>

      <section className="annotatorBody">
        <aside className="sidePanel">
          {hasFilterResults ? (
            <>
              <div className="imageMeta">
                <div className="imageNameRow">
                  <strong>{image.path.split(/[\\/]/).pop()}</strong>
                  <span className={`annotationBadge ${image.annotated ? 'annotationBadgeAnnotated' : 'annotationBadgePending'}`}>
                    {image.annotated ? 'Annotated' : 'Not annotated'}
                  </span>
                </div>
                <span className="imagePath">{image.path}</span>
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
                <button
                  className={`secondary ${samplerActive ? 'activeTool' : ''}`}
                  onClick={() => setSamplerActive((current) => !current)}
                >
                  <Pipette size={18} />Sampler
                </button>
                <button className="secondary" onClick={() => setDisplayResized((current) => !current)}>
                  <Minimize2 size={18} />{displayResized ? 'Original' : 'Resize'}
                </button>
                <button className="secondary" onClick={goNext} disabled={index === filteredImages.length - 1}>Next<ChevronRight size={18} /></button>
              </div>
              {sampleResult?.error && <div className="sampleResult sampleError">{sampleResult.error}</div>}
            </>
          ) : (
            <div className="empty filterEmpty">No images match the current filters</div>
          )}
        </aside>
        <div className={`imageStage ${displayResized ? 'imageStageResized' : ''}`}>
          {hasFilterResults ? (
            <div
              className={`imageSampleSurface ${samplerActive ? 'samplingEnabled' : ''}`}
              onPointerDown={startSampling}
              onPointerMove={updateSampling}
              onPointerUp={finishSampling}
              onPointerCancel={() => { dragStartRef.current = null; }}
            >
              <img
                ref={imageRef}
                src={`${API_URL}/image?path=${encodeURIComponent(image.path)}`}
                alt={image.path}
                crossOrigin="anonymous"
                draggable="false"
              />
              {sampleBox && (
                <div
                  className="sampleBox"
                  style={{
                    left: `${sampleBox.x}px`,
                    top: `${sampleBox.y}px`,
                    width: `${sampleBox.width}px`,
                    height: `${sampleBox.height}px`,
                  }}
                />
              )}
              {sampleBox && sampleResult && !sampleResult.error && (
                <div
                  className="sampleFloatingResult"
                  style={{
                    left: `${sampleBox.x + sampleBox.width}px`,
                    top: `${sampleBox.y}px`,
                    transform: sampleBox.x + sampleBox.width + 230 > imageRef.current?.clientWidth
                      ? 'translate(calc(-100% - 8px), -8px)'
                      : 'translate(8px, -8px)',
                  }}
                >
                  <span
                    className="sampleSwatch"
                    style={{ background: `rgb(${sampleResult.rgb.r}, ${sampleResult.rgb.g}, ${sampleResult.rgb.b})` }}
                  />
                  <strong>{sampleResult.color}</strong>
                  <span>RGB {sampleResult.rgb.r}, {sampleResult.rgb.g}, {sampleResult.rgb.b}</span>
                  <span>HSV {Math.round(sampleResult.hsv.h)}, {Math.round(sampleResult.hsv.s)}, {Math.round(sampleResult.hsv.v)}</span>
                  <button
                    className="sampleClose"
                    title="Remove sample"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSampleBox(null);
                      setSampleResult(null);
                    }}
                  >
                    x
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="empty filterEmpty">Adjust filters to show images</div>
          )}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
