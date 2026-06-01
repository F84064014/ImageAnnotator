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

function conditionValue(image, condition) {
  if (condition.target === 'annotated') {
    return image.annotated ? 'true' : 'false';
  }
  if (condition.target?.startsWith('attribute:')) {
    const attribute = condition.target.slice('attribute:'.length);
    return String(normalizeAttributeValue(image.attributes?.[attribute]));
  }
  if (condition.target?.startsWith('mask:')) {
    const maskName = condition.target.slice('mask:'.length);
    if (!image.mask_status || !(maskName in image.mask_status)) return undefined;
    return image.mask_status?.[maskName] ? 'exists' : 'missing';
  }
  return '';
}

export function imageMatchesFilters(image, filters) {
  return filters.every((condition) => {
    if (!condition.target || !condition.operator) return true;
    const actual = conditionValue(image, condition);
    if (actual === undefined) return true;
    const expected = String(condition.value);
    return condition.operator === '!=' ? actual !== expected : actual === expected;
  });
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
