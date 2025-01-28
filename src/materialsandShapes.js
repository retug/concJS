// This is a file to contain all functionality for material defintions and shape defintions.
// Materials are a class contained in _______
// Shapes are a function to create a _______ base class.

export function toggleMaterialsAndShapesDiv() {
    const materialsAndShapes = document.getElementById('materialsandShapes');
    const materialContent = document.getElementById('materialContent');
    const button = materialsAndShapes.querySelector('.toggle-button');
  
    if (materialContent.style.display === 'none') {
      // Show content and reset width
      materialContent.style.display = 'block';
      materialsAndShapes.style.width = '16.666%'; // Reset to default width
      button.innerHTML = '&#xab;'; // Left-pointing double arrow
    } else {
      // Hide content and shrink the container
      materialContent.style.display = 'none';
      materialsAndShapes.style.width = `${button.offsetWidth}px`; // Set width to match button
      button.innerHTML = '&#xbb;'; // Right-pointing double arrow
    }
  }

  export function toggleShapeButtons() {
    const rectangleButton = document.getElementById("rectangleButton");
    const barbellButton = document.getElementById("barbellButton");
  
    rectangleButton.addEventListener("click", () => {
      rectangleButton.classList.add("active");
      barbellButton.classList.remove("active");
    });
  
    barbellButton.addEventListener("click", () => {
      barbellButton.classList.add("active");
      rectangleButton.classList.remove("active");
    });
  }

