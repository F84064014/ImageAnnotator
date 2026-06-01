export function getSampleBox(start, end) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(deltaX)),
    height: Math.max(1, Math.abs(deltaY)),
  };
}

export function averageImageRegion(imageElement, rect, box) {
  if (!imageElement.complete || imageElement.naturalWidth === 0 || imageElement.naturalHeight === 0) {
    throw new Error('Image is not ready for color sampling yet');
  }

  const scaleX = imageElement.naturalWidth / rect.width;
  const scaleY = imageElement.naturalHeight / rect.height;
  const sourceX = Math.round(box.x * scaleX);
  const sourceY = Math.round(box.y * scaleY);
  const sourceWidth = Math.max(1, Math.round(box.width * scaleX));
  const sourceHeight = Math.max(1, Math.round(box.height * scaleY));

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

  const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
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

  return {
    r: Math.round(red / count),
    g: Math.round(green / count),
    b: Math.round(blue / count),
  };
}
