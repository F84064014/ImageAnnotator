import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Cpu, Download, Filter, Minimize2, Pipette, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { API_URL, api } from '../api/client';
import TriStateAttribute from './TriStateAttribute';
import { classifyColor, rgbToHsv } from '../utils/colorClassifier';
import { averageImageRegion, getSampleBox } from '../utils/sampling';
import {
  getAnnotationBadge,
  getAttributeStats,
  groupAttributes,
  hasSelectedAttribute,
  imageMatchesFilters,
  normalizeAttributeValue,
} from '../utils/attributes';
export default function Annotator({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [displayResized, setDisplayResized] = useState(false);
  const [samplerActive, setSamplerActive] = useState(false);
  const [sampleBox, setSampleBox] = useState(null);
  const [sampleResult, setSampleResult] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState({ loaded: false });
  const [modelBusy, setModelBusy] = useState(false);
  const [modelOperation, setModelOperation] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [modelError, setModelError] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsDirectory, setSettingsDirectory] = useState('');
  const [settingsAttributes, setSettingsAttributes] = useState([]);
  const [filters, setFilters] = useState({ annotated: 'all', attributes: {} });
  const dragStartRef = useRef(null);
  const imageRef = useRef(null);
  const modelConfigInputRef = useRef(null);

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

  useEffect(() => {
    if (!project) return;
    setSettingsDirectory(project.image_directory || '');
    setSettingsAttributes(project.attributes || []);
  }, [project]);

  async function loadModelStatus() {
    try {
      setModelStatus(await api('/model/status'));
    } catch (err) {
      setModelError(err.message);
    }
  }

  useEffect(() => {
    loadModelStatus();
  }, []);

  const filteredImages = useMemo(() => {
    const images = project?.images || [];
    return images.filter((item) => imageMatchesFilters(item, filters));
  }, [project, filters]);
  const image = filteredImages[index];
  const annotatedCount = useMemo(() => project?.images.filter((item) => item.annotated).length || 0, [project]);
  const attributeGroups = useMemo(() => groupAttributes(project?.attributes || []), [project]);
  const attributeStats = useMemo(() => getAttributeStats(project?.images || [], project?.attributes || []), [project]);
  const activeFilterCount = useMemo(() => (
    (filters.annotated === 'all' ? 0 : 1)
    + Object.values(filters.attributes).filter((value) => value !== 'all').length
  ), [filters]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(filteredImages.length - 1, 0)));
  }, [filteredImages.length]);

  async function markCurrentAnnotated() {
    if (!project || !image) return image;
    if (image.annotated && image.annotation_source !== 'model_modified') return image;
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

  async function saveSettings() {
    if (!project) return;
    const attributes = settingsAttributes.map((attribute) => attribute.trim()).filter(Boolean);
    setSettingsBusy(true);
    setSettingsError('');
    try {
      const updated = await api(`/projects/${project.id}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          image_directory: settingsDirectory,
          attributes,
        }),
      });
      setProject(updated);
      setFilters({ annotated: 'all', attributes: {} });
      setIndex(0);
      setSampleBox(null);
      setSampleResult(null);
      return updated;
    } catch (err) {
      setSettingsError(err.message);
      return null;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function scanWithSettings() {
    if (!project) return;
    const updatedSettings = await saveSettings();
    if (!updatedSettings) return;

    setScanBusy(true);
    setSettingsError('');
    try {
      const updated = await api(`/projects/${updatedSettings.id}/scan`, { method: 'POST' });
      setProject(updated);
      setSampleBox(null);
      setSampleResult(null);
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setScanBusy(false);
    }
  }

  function updateSettingAttribute(index, value) {
    setSettingsAttributes((current) => current.map((attribute, itemIndex) => (
      itemIndex === index ? value : attribute
    )));
  }

  function addSettingAttribute() {
    setSettingsAttributes((current) => [...current, 'New-Attribute']);
  }

  function deleteSettingAttribute(index) {
    setSettingsAttributes((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function loadModelConfig(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setModelBusy(true);
    setModelOperation('load');
    setModelError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      setModelStatus(await api('/model/load', {
        method: 'POST',
        body: formData,
      }));
    } catch (err) {
      setModelError(err.message);
    } finally {
      setModelBusy(false);
      setModelOperation('');
      event.target.value = '';
    }
  }

  async function unloadModel() {
    setModelBusy(true);
    setModelOperation('unload');
    setModelError('');
    try {
      setModelStatus(await api('/model/unload', { method: 'POST' }));
    } catch (err) {
      setModelError(err.message);
    } finally {
      setModelBusy(false);
      setModelOperation('');
    }
  }

  async function labelUnannotated() {
    if (!project) return;
    setModelBusy(true);
    setModelOperation('label');
    setModelError('');
    try {
      const result = await api(`/projects/${project.id}/model/label-unannotated`, { method: 'POST' });
      setProject(result.project);
      setSampleBox(null);
      setSampleResult(null);
      await loadModelStatus();
    } catch (err) {
      setModelError(err.message);
    } finally {
      setModelBusy(false);
      setModelOperation('');
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
    let rgb;
    try {
      rgb = averageImageRegion(imageRef.current, point.rect, box);
    } catch (err) {
      setSampleResult({ error: err.message || 'Unable to sample this image. Please refresh after the image finishes loading.' });
      return;
    }
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
          <div className="modelMenu">
            <input
              ref={modelConfigInputRef}
              type="file"
              accept=".yml,.yaml"
              onChange={loadModelConfig}
              hidden
            />
            <button
              className={`secondary ${modelOpen ? 'activeTool' : ''}`}
              onClick={() => {
                setModelOpen((current) => !current);
                setStatsOpen(false);
                setFiltersOpen(false);
                setSettingsOpen(false);
              }}
            >
              <Cpu size={18} />Model
            </button>
            {modelOpen && (
              <div className="modelPanel">
                <div className="modelPanelHeader">
                  <strong>{modelStatus.loaded ? 'Model loaded' : 'Model not loaded'}</strong>
                  {modelStatus.loaded && <span>{modelStatus.attributes?.length || 0} attributes</span>}
                </div>
                <button
                  className="modelAction"
                  onClick={() => modelConfigInputRef.current?.click()}
                  disabled={modelBusy || modelStatus.loaded}
                >
                  {modelOperation === 'load' ? 'Loading...' : 'Load model'}
                </button>
                <button className="modelAction" onClick={unloadModel} disabled={modelBusy || !modelStatus.loaded}>
                  {modelOperation === 'unload' ? 'Unloading...' : 'Unload model'}
                </button>
                <button className="modelAction" onClick={labelUnannotated} disabled={modelBusy || !modelStatus.loaded}>
                  {modelOperation === 'label' ? 'Labeling...' : 'Label unannotated'}
                </button>
                {modelStatus.model_path && <span className="modelPath">{modelStatus.model_path}</span>}
                {modelError && <span className="inlineError">{modelError}</span>}
              </div>
            )}
          </div>
          <div className="statsMenu">
            <button
              className={`secondary ${statsOpen ? 'activeTool' : ''}`}
              onClick={() => {
                setStatsOpen((current) => !current);
                setModelOpen(false);
                setFiltersOpen(false);
                setSettingsOpen(false);
              }}
            >
              <BarChart3 size={18} />Stats
            </button>
            {statsOpen && (
              <div className="statsPanel">
                <div className="statsPanelHeader">
                  <strong>Annotated Data</strong>
                  <span>{annotatedCount} images</span>
                </div>
                {annotatedCount === 0 ? (
                  <div className="empty statsEmpty">No annotated images yet</div>
                ) : (
                  <div className="statsList">
                    {attributeStats.map((item) => (
                      <div className="statsRow" key={item.attribute}>
                        <div className="statsRowHeader">
                          <strong>{item.attribute}</strong>
                          <span>
                            T {item.counts.true} / U {item.counts.unknown} / F {item.counts.false}
                          </span>
                        </div>
                        <div className="statsBar" aria-label={`${item.attribute} proportions`}>
                          <span
                            className="statsBarTrue"
                            style={{ width: `${item.percentages.true}%` }}
                            title={`True ${Math.round(item.percentages.true)}%`}
                          />
                          <span
                            className="statsBarUnknown"
                            style={{ width: `${item.percentages.unknown}%` }}
                            title={`Unknown ${Math.round(item.percentages.unknown)}%`}
                          />
                          <span
                            className="statsBarFalse"
                            style={{ width: `${item.percentages.false}%` }}
                            title={`False ${Math.round(item.percentages.false)}%`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="filterMenu">
            <button
              className={`secondary ${filtersOpen ? 'activeTool' : ''}`}
              onClick={() => {
                setFiltersOpen((current) => !current);
                setModelOpen(false);
                setStatsOpen(false);
                setSettingsOpen(false);
              }}
            >
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
                    <option value="modelAnnotated">Model annotated</option>
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
          <div className="settingsMenu">
            <button
              className={`secondary ${settingsOpen ? 'activeTool' : ''}`}
              onClick={() => {
                setSettingsOpen((current) => !current);
                setModelOpen(false);
                setStatsOpen(false);
                setFiltersOpen(false);
              }}
            >
              <Settings size={18} />Settings
            </button>
            {settingsOpen && (
              <div className="settingsPanel">
                <div className="settingsPanelHeader">
                  <strong>Project Settings</strong>
                </div>
                <label>
                  Image directory
                  <input value={settingsDirectory} onChange={(event) => setSettingsDirectory(event.target.value)} />
                </label>
                <div className="settingsSectionHeader">
                  <strong>Attributes</strong>
                  <button className="textButton" onClick={addSettingAttribute}>
                    <Plus size={16} />Add
                  </button>
                </div>
                <div className="settingsAttributeList">
                  {settingsAttributes.map((attribute, attributeIndex) => (
                    <div className="settingsAttributeRow" key={`${attributeIndex}-${attribute}`}>
                      <input
                        value={attribute}
                        onChange={(event) => updateSettingAttribute(attributeIndex, event.target.value)}
                      />
                      <button
                        className="iconButton danger"
                        title="Delete attribute"
                        onClick={() => deleteSettingAttribute(attributeIndex)}
                        disabled={settingsAttributes.length <= 1}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                {settingsError && <span className="inlineError">{settingsError}</span>}
                <div className="settingsActions">
                  <button className="secondary" onClick={scanWithSettings} disabled={scanBusy || settingsBusy}>
                    <RefreshCw size={18} />{scanBusy ? 'Scanning...' : 'Scan Images'}
                  </button>
                  <button className="primary" onClick={saveSettings} disabled={settingsBusy}>
                    {settingsBusy ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
                  <span className={`annotationBadge ${getAnnotationBadge(image).className}`}>
                    {getAnnotationBadge(image).label}
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
