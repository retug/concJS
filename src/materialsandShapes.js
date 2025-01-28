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
      button.style.position = 'absolute'; // Set button position to absolute
      button.style.top = '10px'; // Set distance from the top of the screen
      button.style.right = '20px'; // Set distance from the right edge of the screen
      button.innerHTML = '&#xbb;'; // Right-pointing double arrow
      materialContent.style.display = 'none';
      materialsAndShapes.style.width = `0`; // Set width to match button
      materialsAndShapes.style.overflow = 'hidden'; // Disable scrolling
      
      button.innerHTML = '&#xbb;'; // Right-pointing double arrow
      // Position the button in the upper-right corner
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

