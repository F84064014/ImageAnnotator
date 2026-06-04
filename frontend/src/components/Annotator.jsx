import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, Brush, ChevronLeft, ChevronRight, Cpu, Download, Edit3, Eraser, Eye, EyeOff, Filter, Minimize2, Pipette, Plus, RefreshCw, Save, Settings, Trash2, X } from 'lucide-react';
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [settingsDirectory, setSettingsDirectory] = useState('');
  const [settingsAttributes, setSettingsAttributes] = useState([]);
  const [settingsMasks, setSettingsMasks] = useState([]);
  const [visibleMasks, setVisibleMasks] = useState({});
  const [editingMask, setEditingMask] = useState('');
  const [maskTool, setMaskTool] = useState('brush');
  const [maskCursor, setMaskCursor] = useState(null);
  const [maskVersions, setMaskVersions] = useState({});
  const [maskStatusLoaded, setMaskStatusLoaded] = useState(false);
  const [maskStatusLoading, setMaskStatusLoading] = useState(false);
  const [maskBusy, setMaskBusy] = useState(false);
  const [maskError, setMaskError] = useState('');
  const [filters, setFilters] = useState([]);
  const dragStartRef = useRef(null);
  const maskDrawingRef = useRef(false);
  const imageRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const modelConfigInputRef = useRef(null);

  async function loadProject() {
    setError('');
    try {
      setProject(await api(`/projects/${projectId}`));
      setMaskStatusLoaded(false);
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
    setSettingsMasks(project.mask_labels || []);
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
  const activeFilterCount = filters.length;
  const filtersUseMasks = useMemo(() => (
    filters.some((condition) => condition.target?.startsWith('mask:'))
  ), [filters]);
  const editingMaskLabel = useMemo(() => (
    (project?.mask_labels || []).find((mask) => mask.name === editingMask)
  ), [project, editingMask]);
  const editingMaskColor = editingMaskLabel?.color || '#ff3b8f';
  const editingMaskOpacity = Number(editingMaskLabel?.opacity ?? 0.55);

  useEffect(() => {
    if (!editingMask || !image || !imageRef.current || !maskCanvasRef.current) return;
    const imageElement = imageRef.current;
    const canvas = maskCanvasRef.current;
    canvas.width = imageElement.clientWidth;
    canvas.height = imageElement.clientHeight;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    const maskImage = new Image();
    maskImage.crossOrigin = 'anonymous';
    maskImage.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offscreenContext = offscreen.getContext('2d');
      offscreenContext.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
      const imageData = offscreenContext.getImageData(0, 0, canvas.width, canvas.height);
      const red = Number.parseInt(editingMaskColor.slice(1, 3), 16);
      const green = Number.parseInt(editingMaskColor.slice(3, 5), 16);
      const blue = Number.parseInt(editingMaskColor.slice(5, 7), 16);
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const value = Math.max(imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]);
        imageData.data[offset] = red;
        imageData.data[offset + 1] = green;
        imageData.data[offset + 2] = blue;
        imageData.data[offset + 3] = value > 127 ? Math.round(255 * editingMaskOpacity) : 0;
      }
      context.putImageData(imageData, 0, 0);
    };
    maskImage.onerror = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
    maskImage.src = maskUrl(image, editingMask);
  }, [editingMask, image?.id, displayResized, editingMaskColor, editingMaskOpacity]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(filteredImages.length - 1, 0)));
  }, [filteredImages.length]);

  useEffect(() => {
    async function loadMaskStatus() {
      if (!project || !filtersUseMasks || maskStatusLoaded || maskStatusLoading) return;
      setMaskStatusLoading(true);
      setMaskError('');
      try {
        const statusByImageId = await api(`/projects/${project.id}/mask-status`);
        setProject((current) => current ? ({
          ...current,
          images: current.images.map((item) => ({
            ...item,
            mask_status: statusByImageId[item.id] || {},
          })),
        }) : current);
        setMaskStatusLoaded(true);
      } catch (err) {
        setMaskError(err.message);
        setMaskStatusLoaded(true);
      } finally {
        setMaskStatusLoading(false);
      }
    }
    loadMaskStatus();
  }, [project?.id, filtersUseMasks, maskStatusLoaded, maskStatusLoading]);

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
          mask_labels: settingsMasks
            .map((label) => ({
              name: label.name.trim(),
              directory: label.directory.trim(),
              color: label.color || '#ff3b8f',
              opacity: Number(label.opacity ?? 0.55),
            }))
            .filter((label) => label.name && label.directory),
        }),
      });
      setProject(updated);
      setMaskStatusLoaded(false);
      setFilters([]);
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
      setMaskStatusLoaded(false);
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

  function updateSettingMask(index, field, value) {
    setSettingsMasks((current) => current.map((mask, itemIndex) => (
      itemIndex === index ? { ...mask, [field]: value } : mask
    )));
  }

  function addSettingMask() {
    setSettingsMasks((current) => [...current, {
      name: 'Mask',
      directory: '/images/masks',
      color: '#ff3b8f',
      opacity: 0.55,
    }]);
  }

  function deleteSettingMask(index) {
    setSettingsMasks((current) => current.filter((_, itemIndex) => itemIndex !== index));
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
      setMaskStatusLoaded(false);
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

  function resetFilterView() {
    setIndex(0);
    setSampleBox(null);
    setSampleResult(null);
  }

  function goToIndex(value) {
    const nextIndex = Number.parseInt(value, 10);
    if (!Number.isFinite(nextIndex)) return;
    const clampedIndex = Math.min(Math.max(nextIndex, 1), filteredImages.length) - 1;
    setIndex(clampedIndex);
    setSampleBox(null);
    setSampleResult(null);
  }

  function clearFilters() {
    resetFilterView();
    setFilters([]);
  }

  function filterValueOptions(target) {
    if (target === 'annotated') {
      return [
        { value: 'true', label: 'True' },
        { value: 'false', label: 'False' },
      ];
    }
    if (target?.startsWith('mask:')) {
      return [
        { value: 'exists', label: 'Exist' },
        { value: 'missing', label: 'Not exist' },
      ];
    }
    return [
      { value: '1', label: 'True' },
      { value: '0', label: 'False' },
      { value: '2', label: 'Unknown' },
    ];
  }

  function defaultFilterValue(target) {
    return filterValueOptions(target)[0].value;
  }

  function addFilterCondition() {
    resetFilterView();
    setFilters((current) => [...current, { target: 'annotated', operator: '==', value: 'true' }]);
  }

  function updateFilterCondition(index, patch) {
    resetFilterView();
    setFilters((current) => current.map((condition, itemIndex) => {
      if (itemIndex !== index) return condition;
      const next = { ...condition, ...patch };
      if (patch.target) {
        next.value = defaultFilterValue(patch.target);
      }
      return next;
    }));
  }

  function deleteFilterCondition(index) {
    resetFilterView();
    setFilters((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function maskUrl(targetImage, maskName) {
    const version = maskVersions[`${targetImage.id}:${maskName}`] || 0;
    return `${API_URL}/projects/${project.id}/images/${targetImage.id}/masks/${encodeURIComponent(maskName)}?v=${version}`;
  }

  function toggleMask(maskName) {
    setVisibleMasks((current) => ({ ...current, [maskName]: !current[maskName] }));
  }

  function startMaskEdit(maskName) {
    setMaskError('');
    setSamplerActive(false);
    setMaskTool('brush');
    setEditingMask(maskName);
    setVisibleMasks((current) => ({ ...current, [maskName]: true }));
  }

  function stopMaskEdit() {
    setEditingMask('');
    setMaskTool('brush');
    setMaskCursor(null);
    maskDrawingRef.current = false;
  }

  function updateMaskCursor(event) {
    if (!editingMask) return;
    const point = getImagePoint(event);
    setMaskCursor(point);
  }

  function drawMaskBrush(event) {
    if (!editingMask || !maskCanvasRef.current) return;
    const point = getImagePoint(event);
    if (!point) return;
    const canvas = maskCanvasRef.current;
    const context = canvas.getContext('2d');
    context.globalCompositeOperation = maskTool === 'erase' ? 'destination-out' : 'source-over';
    context.fillStyle = maskTool === 'erase' ? 'rgba(0, 0, 0, 1)' : editingMaskColor;
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(point.x, point.y, 14, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = 'source-over';
  }

  function startMaskBrush(event) {
    if (!editingMask) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    maskDrawingRef.current = true;
    updateMaskCursor(event);
    drawMaskBrush(event);
  }

  function updateMaskBrush(event) {
    updateMaskCursor(event);
    if (!maskDrawingRef.current) return;
    event.preventDefault();
    drawMaskBrush(event);
  }

  function finishMaskBrush(event) {
    if (!maskDrawingRef.current) return;
    event.preventDefault();
    maskDrawingRef.current = false;
  }

  function clearEditingMask() {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  async function saveEditingMask() {
    if (!editingMask || !image || !maskCanvasRef.current || !imageRef.current) return;
    setMaskBusy(true);
    setMaskError('');
    try {
      const sourceCanvas = maskCanvasRef.current;
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = imageRef.current.naturalWidth;
      outputCanvas.height = imageRef.current.naturalHeight;
      const outputContext = outputCanvas.getContext('2d');
      const rasterCanvas = document.createElement('canvas');
      rasterCanvas.width = outputCanvas.width;
      rasterCanvas.height = outputCanvas.height;
      const rasterContext = rasterCanvas.getContext('2d');
      rasterContext.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      const imageData = rasterContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const isMask = imageData.data[offset + 3] > 0;
        const value = isMask ? 255 : 0;
        imageData.data[offset] = value;
        imageData.data[offset + 1] = value;
        imageData.data[offset + 2] = value;
        imageData.data[offset + 3] = 255;
      }
      outputContext.putImageData(imageData, 0, 0);
      const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/png'));
      const formData = new FormData();
      formData.append('file', blob, 'mask.png');
      await api(`/projects/${project.id}/images/${image.id}/masks/${encodeURIComponent(editingMask)}`, {
        method: 'PUT',
        body: formData,
      });
      const versionKey = `${image.id}:${editingMask}`;
      setMaskVersions((current) => ({ ...current, [versionKey]: (current[versionKey] || 0) + 1 }));
      setVisibleMasks((current) => ({ ...current, [editingMask]: true }));
      setProject((current) => ({
        ...current,
        images: current.images.map((item) => (
          item.id === image.id
            ? {
                ...item,
                mask_status: {
                  ...(item.mask_status || {}),
                  [editingMask]: true,
                },
              }
            : item
        )),
      }));
      stopMaskEdit();
    } catch (err) {
      setMaskError(err.message);
    } finally {
      setMaskBusy(false);
    }
  }

  async function deleteCurrentImage(deleteFile) {
    if (!project || !image) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const updatedProject = await api(`/projects/${project.id}/images/${image.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ delete_file: deleteFile }),
      });
      setProject(updatedProject);
      setSampleBox(null);
      setSampleResult(null);
      setDeleteDialogOpen(false);
      setIndex((current) => Math.min(current, Math.max(updatedProject.images.length - 1, 0)));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.target.matches('textarea, select, [contenteditable="true"]')) return;
      if (event.target.matches('input') && event.target.type !== 'checkbox') return;
      if (event.key.toLowerCase() === 'f') goNext();
      if (event.key.toLowerCase() === 'd') goPrev();
      if (event.key.toLowerCase() === 's') setSamplerActive((current) => !current);
      if (event.key === 'Escape') stopMaskEdit();
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
                <button className="filterAddButton" onClick={addFilterCondition}>
                  <Plus size={18} />Add
                </button>
                {maskStatusLoading && <span className="filterLoading">Checking mask files...</span>}
                {filters.length > 0 && (
                  <div className="filterConditionList">
                    {filters.map((condition, conditionIndex) => (
                      <div className="filterConditionRow" key={conditionIndex}>
                        <select
                          value={condition.target}
                          onChange={(event) => updateFilterCondition(conditionIndex, { target: event.target.value })}
                        >
                          <option value="annotated">Annotated</option>
                          {project.attributes.map((attribute) => (
                            <option value={`attribute:${attribute}`} key={attribute}>{attribute}</option>
                          ))}
                          {(project.mask_labels || []).map((mask) => (
                            <option value={`mask:${mask.name}`} key={mask.name}>Mask: {mask.name}</option>
                          ))}
                        </select>
                        <select
                          value={condition.operator}
                          onChange={(event) => updateFilterCondition(conditionIndex, { operator: event.target.value })}
                        >
                          <option value="==">==</option>
                          <option value="!=">!=</option>
                        </select>
                        <select
                          value={condition.value}
                          onChange={(event) => updateFilterCondition(conditionIndex, { value: event.target.value })}
                        >
                          {filterValueOptions(condition.target).map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <button
                          className="iconButton danger"
                          title="Delete condition"
                          onClick={() => deleteFilterCondition(conditionIndex)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                <div className="settingsSectionHeader">
                  <strong>Mask labels</strong>
                  <button className="textButton" onClick={addSettingMask}>
                    <Plus size={16} />Add
                  </button>
                </div>
                <div className="settingsAttributeList">
                  {settingsMasks.map((mask, maskIndex) => (
                    <div className="maskSettingRow" key={`${maskIndex}-${mask.name}`}>
                      <input
                        value={mask.name}
                        placeholder="Mask name"
                        onChange={(event) => updateSettingMask(maskIndex, 'name', event.target.value)}
                      />
                      <input
                        value={mask.directory}
                        placeholder="Mask directory"
                        onChange={(event) => updateSettingMask(maskIndex, 'directory', event.target.value)}
                      />
                      <input
                        type="color"
                        title="Mask color"
                        value={mask.color || '#ff3b8f'}
                        onChange={(event) => updateSettingMask(maskIndex, 'color', event.target.value)}
                      />
                      <label className="maskOpacityControl">
                        <span>{Math.round(Number(mask.opacity ?? 0.55) * 100)}%</span>
                        <input
                          type="range"
                          min="0.05"
                          max="1"
                          step="0.05"
                          value={mask.opacity ?? 0.55}
                          onChange={(event) => updateSettingMask(maskIndex, 'opacity', event.target.value)}
                        />
                      </label>
                      <button
                        className="iconButton danger"
                        title="Delete mask label"
                        onClick={() => deleteSettingMask(maskIndex)}
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
                {(project.mask_labels || []).length > 0 && (
                  <fieldset className="maskGroup">
                    <legend>Masks</legend>
                    {project.mask_labels.map((mask) => (
                      <div className={`maskRow ${editingMask === mask.name ? 'maskRowEditing' : ''}`} key={mask.name}>
                        <span>{mask.name}</span>
                        <button className="iconButton" title="Toggle mask" onClick={() => toggleMask(mask.name)}>
                          {visibleMasks[mask.name] ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <button className="iconButton" title="Edit mask" onClick={() => startMaskEdit(mask.name)}>
                          <Edit3 size={16} />
                        </button>
                      </div>
                    ))}
                    {editingMask && (
                      <div className="maskEditActions">
                        <span>Editing {editingMask}</span>
                        <div className="maskToolToggle" role="group" aria-label="Mask edit tool">
                          <button
                            className={maskTool === 'brush' ? 'active' : ''}
                            title="Brush"
                            onClick={() => setMaskTool('brush')}
                          >
                            <Brush size={16} />Brush
                          </button>
                          <button
                            className={maskTool === 'erase' ? 'active' : ''}
                            title="Erase"
                            onClick={() => setMaskTool('erase')}
                          >
                            <Eraser size={16} />Erase
                          </button>
                        </div>
                        <button className="secondary" onClick={clearEditingMask}>Clear</button>
                        <button className="secondary" onClick={stopMaskEdit}><X size={16} />Cancel</button>
                        <button className="primary" onClick={saveEditingMask} disabled={maskBusy}>
                          <Save size={16} />{maskBusy ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    )}
                    {maskError && <span className="inlineError">{maskError}</span>}
                  </fieldset>
                )}
              </div>
              <div className="navButtons">
                <button className="secondary" onClick={goPrev} disabled={index === 0}><ChevronLeft size={18} />Prev</button>
                <label className="gotoIndexControl">
                  <span>Go to</span>
                  <input
                    type="number"
                    min="1"
                    max={filteredImages.length}
                    value={hasFilterResults ? index + 1 : ''}
                    onChange={(event) => goToIndex(event.target.value)}
                    disabled={!hasFilterResults}
                  />
                </label>
                <button
                  className={`secondary ${samplerActive ? 'activeTool' : ''}`}
                  onClick={() => setSamplerActive((current) => !current)}
                >
                  <Pipette size={18} />Sampler
                </button>
                <button className="secondary" onClick={() => setDisplayResized((current) => !current)}>
                  <Minimize2 size={18} />{displayResized ? 'Original' : 'Resize'}
                </button>
                <button
                  className="secondary dangerAction"
                  onClick={() => {
                    setDeleteError('');
                    setDeleteDialogOpen(true);
                  }}
                  disabled={!image}
                >
                  <Trash2 size={18} />Delete
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
              onPointerDown={(event) => (editingMask ? startMaskBrush(event) : startSampling(event))}
              onPointerMove={(event) => (editingMask ? updateMaskBrush(event) : updateSampling(event))}
              onPointerUp={(event) => (editingMask ? finishMaskBrush(event) : finishSampling(event))}
              onPointerCancel={() => {
                dragStartRef.current = null;
                maskDrawingRef.current = false;
                setMaskCursor(null);
              }}
              onPointerLeave={() => {
                if (editingMask) setMaskCursor(null);
              }}
            >
              <img
                ref={imageRef}
                src={`${API_URL}/image?path=${encodeURIComponent(image.path)}`}
                alt={image.path}
                crossOrigin="anonymous"
                draggable="false"
              />
              {(project.mask_labels || []).map((mask) => (
                visibleMasks[mask.name] && editingMask !== mask.name && (
                  <div
                    className="maskOverlay"
                    key={`${mask.name}-${maskVersions[`${image.id}:${mask.name}`] || 0}`}
                    style={{
                      '--mask-color': mask.color || '#ff3b8f',
                      '--mask-opacity': Number(mask.opacity ?? 0.55),
                      '--mask-url': `url("${maskUrl(image, mask.name)}")`,
                    }}
                  />
                )
              ))}
              {editingMask && (
                <canvas
                  ref={maskCanvasRef}
                  className="maskEditCanvas"
                  style={{ opacity: editingMaskOpacity }}
                />
              )}
              {editingMask && maskCursor && (
                <div
                  className={`maskBrushCursor ${maskTool === 'erase' ? 'maskBrushCursorErase' : ''}`}
                  style={{
                    '--cursor-x': `${maskCursor.x}px`,
                    '--cursor-y': `${maskCursor.y}px`,
                    '--cursor-size': '28px',
                    '--cursor-color': editingMaskColor,
                  }}
                />
              )}
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
      {deleteDialogOpen && image && (
        <div className="modalBackdrop" onMouseDown={() => !deleteBusy && setDeleteDialogOpen(false)}>
          <div className="modal deleteImageModal" onMouseDown={(event) => event.stopPropagation()}>
            <h2>Delete image</h2>
            <p>{image.path}</p>
            <div className="deleteImageOptions">
              <button className="secondary" onClick={() => deleteCurrentImage(false)} disabled={deleteBusy}>
                Remove from meta
              </button>
              <button className="primary dangerPrimary" onClick={() => deleteCurrentImage(true)} disabled={deleteBusy}>
                Delete original too
              </button>
            </div>
            {deleteError && <div className="alert">{deleteError}</div>}
            <div className="actions">
              <button className="secondary" onClick={() => setDeleteDialogOpen(false)} disabled={deleteBusy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
