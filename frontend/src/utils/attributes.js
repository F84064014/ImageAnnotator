export function normalizeAttributeValue(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return [0, 1, 2].includes(value) ? value : 2;
}

export function groupAttributes(attributes) {
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

export function getAnnotationStatus(image) {
  if (!image.annotated) return 'notAnnotated';
  if (['model', 'model_modified'].includes(image.annotation_source)) return 'modelAnnotated';
  return 'annotated';
}

export function imageMatchesFilters(image, filters) {
  if (filters.annotated !== 'all' && getAnnotationStatus(image) !== filters.annotated) return false;
  return Object.entries(filters.attributes).every(([attribute, value]) => (
    value === 'all' || normalizeAttributeValue(image.attributes?.[attribute]) === Number(value)
  ));
}

export function hasSelectedAttribute(image, attributes) {
  return attributes.some((attribute) => normalizeAttributeValue(image.attributes?.[attribute]) !== 0);
}

export function getAnnotationBadge(image) {
  if (getAnnotationStatus(image) === 'modelAnnotated') {
    return { label: 'Model annotated', className: 'annotationBadgeModel' };
  }
  if (getAnnotationStatus(image) === 'annotated') {
    return { label: 'Annotated', className: 'annotationBadgeAnnotated' };
  }
  return { label: 'Not annotated', className: 'annotationBadgePending' };
}

export function getAttributeStats(images, attributes) {
  const annotatedImages = images.filter((image) => image.annotated);
  return attributes.map((attribute) => {
    const counts = annotatedImages.reduce((accumulator, image) => {
      const value = normalizeAttributeValue(image.attributes?.[attribute]);
      if (value === 1) accumulator.true += 1;
      if (value === 2) accumulator.unknown += 1;
      if (value === 0) accumulator.false += 1;
      return accumulator;
    }, { true: 0, unknown: 0, false: 0 });
    const total = annotatedImages.length;
    return {
      attribute,
      total,
      counts,
      percentages: {
        true: total ? (counts.true / total) * 100 : 0,
        unknown: total ? (counts.unknown / total) * 100 : 0,
        false: total ? (counts.false / total) * 100 : 0,
      },
    };
  });
}
