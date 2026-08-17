const MAX_DIMENSION = 900;

let tholdDarks = 0;
let tholdMids = 67;

document.getElementById('inputFile').addEventListener('change', handleImageUpload);
document.getElementById('loadBtn').addEventListener('click', loadImageFromURL);
document.getElementById('tholdDarks').addEventListener('input', handleSliderChange);
document.getElementById('tholdMids').addEventListener('input', handleSliderChange);

function handleImageUpload() {
  const file = this.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const imageSrc = e.target.result;
      displayImage(imageSrc, 'originalImage');
      applyImageModifications(imageSrc);
    };
    reader.readAsDataURL(file);
  }
}

function loadImageFromURL() {
  const imageUrl = document.getElementById('inputUrl').value;
  if (imageUrl) {
    displayImage(imageUrl, 'originalImage');
    applyImageModifications(imageUrl);
  }
}

// Update the handleSliderChange function to display the current values
function handleSliderChange() {
  tholdDarks = document.getElementById('tholdDarks').value;
  tholdMids = document.getElementById('tholdMids').value;

  document.getElementById('tholdDarksValue').innerText = tholdDarks;
  document.getElementById('tholdMidsValue').innerText = tholdMids;

  const imageSrc = document.getElementById('originalImage').src;
  applyImageModifications(imageSrc);
}

// Initialize the displayed values when the page loads
document.getElementById('tholdDarksValue').innerText = tholdDarks;
document.getElementById('tholdMidsValue').innerText = tholdMids;

function displayImage(imageSrc, targetElementId) {
  const image = new Image();
  const imageElement = document.getElementById(targetElementId);

  image.crossOrigin = 'Anonymous';

  image.onload = function () {
    const { width, height } = resizeDimensions(image.width, image.height);
    imageElement.width = width;
    imageElement.height = height;
    imageElement.src = imageSrc;
  };

  image.src = imageSrc;
  generateHistogram(imageSrc); // Add this line to generate the histogram
}

// function resizeDimensions(width, height) {
//   if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
//     if (width > height) {
//       height = height * (MAX_DIMENSION / width);
//       width = MAX_DIMENSION;
//     } else {
//       width = width * (MAX_DIMENSION / height);
//       height = MAX_DIMENSION;
//     }
//   }

//   return { width, height };
// }

function resizeDimensions(width, height) {
  // If the image is smaller than the maximum dimension, upscale it
  if (width < MAX_DIMENSION && height < MAX_DIMENSION) {
    if (width > height) {
      height = height * (MAX_DIMENSION / width);
      width = MAX_DIMENSION;
    } else {
      width = width * (MAX_DIMENSION / height);
      height = MAX_DIMENSION;
    }
  }
  // Otherwise, resize it proportionally
  else if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width > height) {
      height = height * (MAX_DIMENSION / width);
      width = MAX_DIMENSION;
    } else {
      width = width * (MAX_DIMENSION / height);
      height = MAX_DIMENSION;
    }
  }

  return { width, height };
}

function applyImageModifications(imageSrc) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const modifiedImage = new Image();

  modifiedImage.crossOrigin = 'Anonymous';

  modifiedImage.onload = function () {
    const { width, height } = resizeDimensions(modifiedImage.width, modifiedImage.height);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(modifiedImage, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let maxBrightness = 0;

    // Calculate maximum brightness value
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      maxBrightness = Math.max(maxBrightness, brightness);
    }

    const thresholdDarks = maxBrightness * (tholdDarks / 100);
    const thresholdMids = maxBrightness * (tholdMids / 100);

    // Apply color modifications based on brightness thresholds
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;

      if (brightness < thresholdDarks) {
        // Set color to black
        data[i] = data[i + 1] = data[i + 2] = 0;
      } else if (brightness < thresholdMids) {
        // Set color to gray
        data[i] = data[i + 1] = data[i + 2] = 128;
      } else {
        // Set color to white
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Display the modified image
    const modifiedImageElement = document.createElement('img');
    modifiedImageElement.src = canvas.toDataURL();
    const modifiedImageContainer = document.querySelector('.column:nth-child(2)');
    modifiedImageContainer.innerHTML = '<h2>Value Study</h2>';
    modifiedImageContainer.appendChild(modifiedImageElement);
  };

  modifiedImage.src = imageSrc;
}

// Add this function to your existing JavaScript code
function generateHistogram(imageSrc) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.crossOrigin = 'Anonymous';

  img.onload = function () {
    const { width, height } = resizeDimensions(img.width, img.height);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const histogramData = new Array(256).fill(0);

    for (let i = 0; i < data.length; i += 4) {
      const brightness = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
      histogramData[brightness]++;
    }

    drawHistogram(histogramData);
  };

  img.src = imageSrc;
}

// Add this function to your existing JavaScript code
function drawHistogram(histogramData) {
  const histogramCanvas = document.getElementById('histogram');
  const ctx = histogramCanvas.getContext('2d');
  const canvasWidth = histogramCanvas.width;
  const canvasHeight = histogramCanvas.height;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const barWidth = canvasWidth / histogramData.length;
  const maxCount = Math.max(...histogramData);
  const scaleFactor = canvasHeight / maxCount;

  ctx.fillStyle = 'black';

  for (let i = 0; i < histogramData.length; i++) {
    const barHeight = histogramData[i] * scaleFactor;
    const x = i * barWidth;
    const y = canvasHeight - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);
  }
}
