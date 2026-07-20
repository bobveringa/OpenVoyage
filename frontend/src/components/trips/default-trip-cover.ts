const defaultTripCover = {
  fileName: 'green-ridge-cover',
  name: 'Green ridge',
}

export async function createDefaultTripCoverFile(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 1440
  canvas.height = 960

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create default trip cover image')
  }

  drawGreenRidgeCover(context, canvas.width, canvas.height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob)
      } else {
        reject(new Error('Could not export default trip cover image'))
      }
    }, 'image/png')
  })

  return new File([blob], `${defaultTripCover.fileName}.png`, {
    type: 'image/png',
  })
}

export function getDefaultTripCoverName() {
  return defaultTripCover.name
}

function drawGreenRidgeCover(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const sky = context.createLinearGradient(0, 0, width, height)
  sky.addColorStop(0, '#d8f7df')
  sky.addColorStop(0.42, '#edf8d9')
  sky.addColorStop(1, '#f5d88f')
  context.fillStyle = sky
  context.fillRect(0, 0, width, height)

  drawGlow(context, width * 0.78, height * 0.2, width * 0.34, '#f4c867', 0.42)
  drawGlow(context, width * 0.18, height * 0.18, width * 0.28, '#74c69d', 0.3)

  drawLayeredHill(context, width, height, height * 0.48, '#99d88f', 0.9)
  drawLayeredHill(context, width, height, height * 0.58, '#5fac72', 0.94)
  drawLayeredHill(context, width, height, height * 0.72, '#277149', 1)

  context.fillStyle = 'rgba(255,255,255,0.42)'
  for (let index = 0; index < 7; index += 1) {
    const x = width * (0.12 + index * 0.13)
    const y = height * (0.22 + (index % 2) * 0.035)
    drawCloud(context, x, y, width * 0.055)
  }
}

function drawLayeredHill(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  top: number,
  color: string,
  alpha: number,
) {
  context.save()
  context.globalAlpha = alpha
  context.beginPath()
  context.moveTo(0, height)
  context.lineTo(0, top)
  context.bezierCurveTo(
    width * 0.22,
    top - 80,
    width * 0.36,
    top + 70,
    width * 0.54,
    top,
  )
  context.bezierCurveTo(
    width * 0.72,
    top - 85,
    width * 0.82,
    top + 55,
    width,
    top - 25,
  )
  context.lineTo(width, height)
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.restore()
}

function drawGlow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const glow = context.createRadialGradient(x, y, 0, x, y, radius)
  glow.addColorStop(0, color)
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  context.save()
  context.globalAlpha = alpha
  context.fillStyle = glow
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  context.restore()
}

function drawCloud(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  context.beginPath()
  context.ellipse(x, y, radius, radius * 0.38, 0, 0, Math.PI * 2)
  context.ellipse(
    x + radius * 0.52,
    y - radius * 0.08,
    radius * 0.82,
    radius * 0.42,
    0,
    0,
    Math.PI * 2,
  )
  context.ellipse(
    x + radius * 1.16,
    y,
    radius * 0.64,
    radius * 0.34,
    0,
    0,
    Math.PI * 2,
  )
  context.fill()
}
