const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

function solveLinear(matrix, values) {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('Perspective invalide')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let cell = column; cell <= size; cell += 1) rows[column][cell] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let cell = column; cell <= size; cell += 1) rows[row][cell] -= factor * rows[column][cell]
    }
  }
  return rows.map(row => row[size])
}

function destinationToSourceHomography(corners, width, height) {
  const destination = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]
  const matrix = []
  const values = []
  destination.forEach((point, index) => {
    const source = corners[index]
    matrix.push([point.x, point.y, 1, 0, 0, 0, -source.x * point.x, -source.x * point.y])
    values.push(source.x)
    matrix.push([0, 0, 0, point.x, point.y, 1, -source.y * point.x, -source.y * point.y])
    values.push(source.y)
  })
  return solveLinear(matrix, values)
}

export function defaultDocumentCorners(width, height) {
  const insetX = width * 0.06
  const insetY = height * 0.05
  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY },
  ]
}

const angleDistance = (first, second) => {
  const difference = Math.abs(first - second) % 180
  return Math.min(difference, 180 - difference)
}

const intersectLines = (first, second) => {
  const determinant = first.cos * second.sin - second.cos * first.sin
  if (Math.abs(determinant) < 1e-5) return null
  return {
    x: (first.rho * second.sin - second.rho * first.sin) / determinant,
    y: (first.cos * second.rho - second.cos * first.rho) / determinant,
  }
}

export function autoDetectDocumentCorners(sourceCanvas) {
  const maximum = 620
  const scale = Math.min(1, maximum / Math.max(sourceCanvas.width, sourceCanvas.height))
  const width = Math.max(80, Math.round(sourceCanvas.width * scale))
  const height = Math.max(80, Math.round(sourceCanvas.height * scale))
  const work = document.createElement('canvas')
  work.width = width
  work.height = height
  const context = work.getContext('2d', { willReadFrequently: true })
  context.drawImage(sourceCanvas, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height).data
  const gray = new Uint8Array(width * height)
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel += 1) {
    gray[pixel] = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114)
  }

  const gradients = []
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const at = (offsetX, offsetY) => gray[(y + offsetY) * width + x + offsetX]
      const gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1)
      const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1)
      const magnitude = Math.hypot(gx, gy)
      if (magnitude > 85) gradients.push({ x, y, magnitude, theta: (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180 })
    }
  }
  if (gradients.length < 80) return defaultDocumentCorners(sourceCanvas.width, sourceCanvas.height)
  gradients.sort((a, b) => b.magnitude - a.magnitude)
  const points = gradients.slice(0, Math.min(14000, Math.max(1200, Math.round(gradients.length * 0.38))))
  const diagonal = Math.ceil(Math.hypot(width, height))
  const rhoCount = diagonal * 2 + 1
  const votes = new Uint32Array(180 * rhoCount)
  const trig = Array.from({ length: 180 }, (_, theta) => ({
    cos: Math.cos(theta * Math.PI / 180),
    sin: Math.sin(theta * Math.PI / 180),
  }))

  points.forEach(point => {
    const normal = Math.round(point.theta)
    const weight = Math.max(1, Math.min(12, Math.round(point.magnitude / 90)))
    for (let delta = -3; delta <= 3; delta += 1) {
      const theta = (normal + delta + 180) % 180
      const rho = Math.round(point.x * trig[theta].cos + point.y * trig[theta].sin) + diagonal
      if (rho >= 0 && rho < rhoCount) votes[theta * rhoCount + rho] += weight
    }
  })

  const peaks = []
  for (let theta = 0; theta < 180; theta += 1) {
    for (let rhoIndex = 2; rhoIndex < rhoCount - 2; rhoIndex += 1) {
      const score = votes[theta * rhoCount + rhoIndex]
      if (score < 18) continue
      if (score < votes[theta * rhoCount + rhoIndex - 2] || score < votes[theta * rhoCount + rhoIndex + 2]) continue
      peaks.push({ theta, rho: rhoIndex - diagonal, score, ...trig[theta] })
    }
  }
  peaks.sort((a, b) => b.score - a.score)
  const lines = []
  for (const peak of peaks) {
    if (lines.some(line => angleDistance(line.theta, peak.theta) < 4 && Math.abs(line.rho - peak.rho) < 14)) continue
    lines.push(peak)
    if (lines.length >= 36) break
  }

  const pairs = []
  const minimumSeparation = Math.min(width, height) * 0.28
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const angle = angleDistance(lines[first].theta, lines[second].theta)
      const separation = Math.abs(lines[first].rho - lines[second].rho)
      if (angle > 13 || separation < minimumSeparation) continue
      pairs.push({
        lines: [lines[first], lines[second]],
        theta: lines[first].theta,
        score: (lines[first].score + lines[second].score) * Math.min(2, separation / minimumSeparation),
      })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  let best = null
  const candidates = pairs.slice(0, 28)
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const perpendicular = angleDistance(candidates[first].theta, candidates[second].theta)
      if (perpendicular < 62 || perpendicular > 118) continue
      const intersections = []
      for (const lineA of candidates[first].lines) {
        for (const lineB of candidates[second].lines) intersections.push(intersectLines(lineA, lineB))
      }
      if (intersections.some(point => !point || point.x < -width * .16 || point.x > width * 1.16 || point.y < -height * .16 || point.y > height * 1.16)) continue
      const ordered = orderDocumentCorners(intersections)
      const area = Math.abs(ordered.reduce((sum, point, index) => {
        const next = ordered[(index + 1) % 4]
        return sum + point.x * next.y - next.x * point.y
      }, 0) / 2)
      const areaRatio = area / (width * height)
      if (areaRatio < .18 || areaRatio > 1.18) continue
      const score = candidates[first].score + candidates[second].score + areaRatio * 900
      if (!best || score > best.score) best = { corners: ordered, score }
    }
  }
  if (!best) return defaultDocumentCorners(sourceCanvas.width, sourceCanvas.height)
  return best.corners.map(point => ({
    x: Math.max(0, Math.min(sourceCanvas.width, point.x / scale)),
    y: Math.max(0, Math.min(sourceCanvas.height, point.y / scale)),
  }))
}

export function orderDocumentCorners(points) {
  if (!Array.isArray(points) || points.length !== 4) throw new Error('Quatre coins sont requis')
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }), { x: 0, y: 0 })
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x))
  const start = sorted.reduce((best, point, index) => (point.x + point.y < sorted[best].x + sorted[best].y ? index : best), 0)
  return [...sorted.slice(start), ...sorted.slice(0, start)]
}

const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)

export function validateDocumentCorners(inputCorners, imageWidth, imageHeight) {
  let corners
  try {
    corners = orderDocumentCorners(inputCorners)
  } catch {
    return { valid: false, reason: 'Quatre coins distincts sont requis' }
  }
  const turns = corners.map((point, index) => cross(point, corners[(index + 1) % 4], corners[(index + 2) % 4]))
  const sameDirection = turns.every(value => value > 0) || turns.every(value => value < 0)
  if (!sameDirection || turns.some(value => Math.abs(value) < 1)) {
    return { valid: false, reason: 'Les contours se croisent ou un coin est placé à l’intérieur du document' }
  }
  const area = Math.abs(corners.reduce((sum, point, index) => {
    const next = corners[(index + 1) % 4]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
  if (area < imageWidth * imageHeight * 0.012) {
    return { valid: false, reason: 'La zone sélectionnée est trop petite' }
  }
  const minimumEdge = Math.min(
    distance(corners[0], corners[1]), distance(corners[1], corners[2]),
    distance(corners[2], corners[3]), distance(corners[3], corners[0]),
  )
  if (minimumEdge < Math.min(imageWidth, imageHeight) * 0.025) {
    return { valid: false, reason: 'Deux coins sont trop proches' }
  }
  return { valid: true, corners, area }
}

function intelligentOutputSize(corners, formatMode) {
  // The geometric mean reduces the influence of a strongly foreshortened edge.
  const top = distance(corners[0], corners[1])
  const right = distance(corners[1], corners[2])
  const bottom = distance(corners[3], corners[2])
  const left = distance(corners[0], corners[3])
  let width = Math.sqrt(Math.max(1, top * bottom))
  let height = Math.sqrt(Math.max(1, left * right))
  const measuredRatio = width / height
  const a4Portrait = 1 / Math.sqrt(2)
  const a4Landscape = Math.sqrt(2)
  let targetRatio = measuredRatio

  if (formatMode === 'a4') {
    targetRatio = measuredRatio <= 1 ? a4Portrait : a4Landscape
  } else if (formatMode === 'auto') {
    // Phone photos can heavily shorten one side. A broad A-series window is
    // intentional; very long receipts remain outside it and keep their ratio.
    if (measuredRatio >= 0.50 && measuredRatio <= 0.96) targetRatio = a4Portrait
    else if (measuredRatio >= 1.04 && measuredRatio <= 2.0) targetRatio = a4Landscape
  }

  if (targetRatio !== measuredRatio) {
    const area = width * height
    width = Math.sqrt(area * targetRatio)
    height = Math.sqrt(area / targetRatio)
  }
  return { width, height, measuredRatio, targetRatio }
}

export function perspectiveDocument(sourceCanvas, inputCorners, options = {}) {
  const { maxDimension = 2400, formatMode = 'auto' } = typeof options === 'number'
    ? { maxDimension: options, formatMode: 'auto' }
    : options
  const validation = validateDocumentCorners(inputCorners, sourceCanvas.width, sourceCanvas.height)
  if (!validation.valid) throw new Error(validation.reason)
  const corners = validation.corners
  let { width, height } = intelligentOutputSize(corners, formatMode)
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  width = Math.max(64, Math.round(width * scale))
  height = Math.max(64, Math.round(height * scale))

  const homography = destinationToSourceHomography(corners, width, height)
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const outputContext = output.getContext('2d')
  const target = outputContext.createImageData(width, height)
  const [a, b, c, d, e, f, g, h] = homography

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator = g * x + h * y + 1
      const sourceX = Math.max(0, Math.min(sourceCanvas.width - 1.001, (a * x + b * y + c) / denominator))
      const sourceY = Math.max(0, Math.min(sourceCanvas.height - 1.001, (d * x + e * y + f) / denominator))
      const x0 = Math.floor(sourceX)
      const y0 = Math.floor(sourceY)
      const x1 = Math.min(sourceCanvas.width - 1, x0 + 1)
      const y1 = Math.min(sourceCanvas.height - 1, y0 + 1)
      const dx = sourceX - x0
      const dy = sourceY - y0
      const topLeft = (y0 * sourceCanvas.width + x0) * 4
      const topRight = (y0 * sourceCanvas.width + x1) * 4
      const bottomLeft = (y1 * sourceCanvas.width + x0) * 4
      const bottomRight = (y1 * sourceCanvas.width + x1) * 4
      const targetIndex = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const topValue = source.data[topLeft + channel] * (1 - dx) + source.data[topRight + channel] * dx
        const bottomValue = source.data[bottomLeft + channel] * (1 - dx) + source.data[bottomRight + channel] * dx
        target.data[targetIndex + channel] = topValue * (1 - dy) + bottomValue * dy
      }
      target.data[targetIndex + 3] = 255
    }
  }
  outputContext.putImageData(target, 0, 0)
  return output
}

export function filterDocument(sourceCanvas, mode = 'enhanced', brightness = 0, contrast = 15) {
  const output = document.createElement('canvas')
  output.width = sourceCanvas.width
  output.height = sourceCanvas.height
  const context = output.getContext('2d', { willReadFrequently: true })
  context.drawImage(sourceCanvas, 0, 0)
  if (mode === 'original' && brightness === 0 && contrast === 0) return output
  const image = context.getImageData(0, 0, output.width, output.height)
  const contrastFactor = (259 * (Number(contrast) + 255)) / (255 * (259 - Number(contrast)))
  const brightnessOffset = Number(brightness) * 2.55
  let whiteBalance = [1, 1, 1]
  let illumination = null
  let illuminationWidth = 0
  let illuminationHeight = 0

  const usesIlluminationMap = mode === 'enhanced' || mode === 'color' || mode === 'bw'
  if (usesIlluminationMap) {
    const histogram = new Uint32Array(256)
    let samples = 0
    for (let index = 0; index < image.data.length; index += 64) {
      const luminance = Math.round(0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2])
      histogram[luminance] += 1
      samples += 1
    }
    let accumulated = 0
    let brightThreshold = 220
    for (let value = 255; value >= 0; value -= 1) {
      accumulated += histogram[value]
      if (accumulated >= samples * 0.075) {
        brightThreshold = Math.max(150, value)
        break
      }
    }
    const bright = [0, 0, 0]
    let brightCount = 0
    for (let index = 0; index < image.data.length; index += 64) {
      const luminance = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2]
      if (luminance < brightThreshold) continue
      bright[0] += image.data[index]
      bright[1] += image.data[index + 1]
      bright[2] += image.data[index + 2]
      brightCount += 1
    }
    if (brightCount) {
      const averages = bright.map(value => value / brightCount)
      const neutral = (averages[0] + averages[1] + averages[2]) / 3
      whiteBalance = averages.map(value => Math.max(0.72, Math.min(1.38, neutral / Math.max(1, value))))
    }
    const backgroundCanvas = document.createElement('canvas')
    // A medium-resolution illumination map follows phone shadows and page
    // curvature while ignoring letters and thin printed lines.
    illuminationWidth = Math.min(192, output.width)
    illuminationHeight = Math.max(1, Math.round(output.height * illuminationWidth / output.width))
    backgroundCanvas.width = illuminationWidth
    backgroundCanvas.height = illuminationHeight
    const backgroundContext = backgroundCanvas.getContext('2d', { willReadFrequently: true })
    backgroundContext.filter = 'blur(9px)'
    backgroundContext.drawImage(sourceCanvas, 0, 0, illuminationWidth, illuminationHeight)
    illumination = backgroundContext.getImageData(0, 0, illuminationWidth, illuminationHeight).data
  }

  for (let index = 0; index < image.data.length; index += 4) {
    let red = image.data[index] * whiteBalance[0]
    let green = image.data[index + 1] * whiteBalance[1]
    let blue = image.data[index + 2] * whiteBalance[2]
    const pixel = index / 4
    const x = pixel % output.width
    const y = Math.floor(pixel / output.width)
    let localBackground = null
    if (usesIlluminationMap) {
      const backgroundX = Math.min(illuminationWidth - 1, Math.floor(x * illuminationWidth / output.width))
      const backgroundY = Math.min(illuminationHeight - 1, Math.floor(y * illuminationHeight / output.height))
      const backgroundIndex = (backgroundY * illuminationWidth + backgroundX) * 4
      localBackground = [
        illumination[backgroundIndex],
        illumination[backgroundIndex + 1],
        illumination[backgroundIndex + 2],
      ]
    }
    if (mode === 'gray') {
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
      red = luminance
      green = luminance
      blue = luminance
    } else if (mode === 'enhanced' || mode === 'bw') {
      const backgroundLuminance = 0.299 * localBackground[0] + 0.587 * localBackground[1] + 0.114 * localBackground[2]
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
      let normalized = Math.max(0, Math.min(255, luminance / Math.max(42, backgroundLuminance) * 250))
      // Clean paper becomes white; ink remains dense. The soft knees avoid
      // jagged Arabic glyphs and preserve stamps and signatures.
      if (normalized > 202) normalized += (255 - normalized) * .72
      else if (normalized < 178) normalized *= .88
      red = normalized
      green = normalized
      blue = normalized
    } else if (mode === 'color') {
      red = red / Math.max(42, localBackground[0]) * 248
      green = green / Math.max(42, localBackground[1]) * 248
      blue = blue / Math.max(42, localBackground[2]) * 248
      const maximum = Math.max(red, green, blue)
      if (maximum > 212) {
        const paperBoost = (maximum - 212) / 43 * .58
        red += (255 - red) * paperBoost
        green += (255 - green) * paperBoost
        blue += (255 - blue) * paperBoost
      }
    }
    red = contrastFactor * (red - 128) + 128 + brightnessOffset
    green = contrastFactor * (green - 128) + 128 + brightnessOffset
    blue = contrastFactor * (blue - 128) + 128 + brightnessOffset
    if (mode === 'bw') {
      // A soft local threshold is much cleaner than one global threshold on
      // phone photos and keeps small punctuation readable after printing.
      const threshold = 170
      const transition = 10
      const value = red <= threshold - transition ? 0 : red >= threshold + transition
        ? 255
        : Math.round((red - threshold + transition) / (transition * 2) * 255)
      red = value
      green = value
      blue = value
    }
    image.data[index] = Math.max(0, Math.min(255, red))
    image.data[index + 1] = Math.max(0, Math.min(255, green))
    image.data[index + 2] = Math.max(0, Math.min(255, blue))
  }
  context.putImageData(image, 0, 0)
  return output
}

export function suggestDocumentAdjustments(sourceCanvas) {
  const sample = document.createElement('canvas')
  const width = Math.min(220, sourceCanvas.width)
  sample.width = width
  sample.height = Math.max(1, Math.round(sourceCanvas.height * width / sourceCanvas.width))
  const context = sample.getContext('2d', { willReadFrequently: true })
  context.drawImage(sourceCanvas, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  let luminanceSum = 0
  let luminanceSquared = 0
  let colorDifference = 0
  let count = 0
  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const luminance = .299 * red + .587 * green + .114 * blue
    luminanceSum += luminance
    luminanceSquared += luminance * luminance
    colorDifference += Math.max(red, green, blue) - Math.min(red, green, blue)
    count += 1
  }
  const mean = luminanceSum / Math.max(1, count)
  const deviation = Math.sqrt(Math.max(0, luminanceSquared / Math.max(1, count) - mean * mean))
  const chroma = colorDifference / Math.max(1, count)
  // Preserve stamps/signatures when meaningful colour is present; otherwise
  // favor the clearest text-oriented scan.
  const filter = chroma > 27 ? 'color' : 'enhanced'
  const brightness = Math.round(Math.max(-8, Math.min(16, (205 - mean) / 7)))
  const contrast = Math.round(Math.max(10, Math.min(36, 30 - deviation / 3)))
  return { filter, brightness, contrast }
}

export function rotateDocument(sourceCanvas) {
  const output = document.createElement('canvas')
  output.width = sourceCanvas.height
  output.height = sourceCanvas.width
  const context = output.getContext('2d')
  context.translate(output.width, 0)
  context.rotate(Math.PI / 2)
  context.drawImage(sourceCanvas, 0, 0)
  return output
}
